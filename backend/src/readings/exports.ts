import { createReadStream } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import type { SensorReading } from '@prisma/client';
import { logger } from '../config/logger.js';
import { scanSavedReadings } from './historyScan.js';
import { OracleObjects } from './oracleObjects.js';
import { ReadingsStore } from './readingsStore.js';

const HEADER = ['station_id', 'sensor_id', 'received_at_utc', 'device_time_raw', 'temperature_c', 'temperature_2_c', 'humidity_percent', 'secondary', 'battery_v', 'raw_status', 'raw_fields'];

function csvCell(value: unknown): string {
  const stringValue = value === null || value === undefined ? '' : String(value);
  const safe = typeof value === 'string' && /^[=+\-@\t\r]/.test(stringValue) ? `'${stringValue}` : stringValue;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function readingCsvLine(row: SensorReading): string {
  return [row.stationId, row.sensorId, row.receivedAt.toISOString(), row.deviceTimeRaw,
    row.temperature, row.temperature2, row.humidity, row.secondary, row.battery,
    row.rawStatus, JSON.stringify(row.rawFields)].map(csvCell).join(',') + '\n';
}

export class SensorExports {
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(private readings: ReadingsStore, private objects: OracleObjects, private dataDir = './data') {}

  async start(): Promise<void> {
    // A process restart leaves no active worker. Pending jobs are safe to retry;
    // the object key is deterministic and only DONE jobs are downloadable.
    await this.readings.prisma.sensorExportJob.updateMany({ where: { status: 'PROCESSING' }, data: { status: 'PENDING' } });
    this.timer = setInterval(() => { void this.processOne().catch((error) => logger.error({ error }, 'sensor export worker failed')); }, 5_000);
    void this.processOne().catch((error) => logger.error({ error }, 'sensor export worker failed'));
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async create(requestedBy: string, sensorIds: string[], from: Date, to: Date) {
    if (!(from < to)) throw new Error('End time must be after start time');
    const active = await this.readings.prisma.sensorExportJob.count({ where: { requestedBy, status: { in: ['PENDING', 'PROCESSING'] } } });
    if (active >= 2) throw new Error('Two exports are already being prepared; please wait for one to finish');
    return this.readings.prisma.sensorExportJob.create({ data: { requestedBy, sensorIds, from, to, status: 'PENDING' } });
  }

  async list(requestedBy: string) {
    return this.readings.prisma.sensorExportJob.findMany({ where: { requestedBy }, orderBy: { createdAt: 'desc' }, take: 30 });
  }

  async downloadUrl(id: string, requestedBy: string): Promise<string | null> {
    const job = await this.readings.prisma.sensorExportJob.findFirst({ where: { id, requestedBy, status: 'DONE' } });
    if (!job?.objectKey) return null;
    return `/api/readings/exports/${job.id}/file`;
  }

  async openDownload(id: string, requestedBy: string): Promise<{ source: Readable; filename: string } | null> {
    const job = await this.readings.prisma.sensorExportJob.findFirst({ where: { id, requestedBy, status: 'DONE' } });
    if (!job?.objectKey) return null;
    const filename = `sensor-readings-${job.from.toISOString().slice(0, 10)}-${job.to.toISOString().slice(0, 10)}.csv`;
    if (job.objectKey.startsWith('local:')) {
      const path = join(this.dataDir, 'exports', `${job.id}.csv.gz`);
      try { await stat(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
      return { source: createReadStream(path), filename };
    }
    return { source: await this.objects.readStream(job.objectKey), filename };
  }

  async cleanupExpired(ttlDays: number, now = new Date()): Promise<void> {
    const cutoff = new Date(now.getTime() - ttlDays * 86_400_000);
    const oldJobs = await this.readings.prisma.sensorExportJob.findMany({
      where: { status: { in: ['DONE', 'FAILED'] }, updatedAt: { lt: cutoff } }, take: 100,
    });
    for (const job of oldJobs) {
      if (job.objectKey?.startsWith('local:')) await rm(join(this.dataDir, 'exports', `${job.id}.csv.gz`), { force: true });
      else if (job.objectKey) await this.objects.delete(job.objectKey);
      await this.readings.prisma.sensorExportJob.delete({ where: { id: job.id } });
    }
  }

  private async processOne(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const job = await this.readings.prisma.sensorExportJob.findFirst({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' } });
      if (!job) return;
      const claim = await this.readings.prisma.sensorExportJob.updateMany({ where: { id: job.id, status: 'PENDING' }, data: { status: 'PROCESSING', error: null } });
      if (claim.count === 0) return;
      try {
        const count = await this.generate(job.id, job.sensorIds as string[], job.from, job.to);
        await this.readings.prisma.sensorExportJob.update({ where: { id: job.id }, data: { status: 'DONE', objectKey: `sensor-exports/${job.id}.csv.gz`, rowCount: BigInt(count) } });
      } catch (error) {
        logger.error({ error, jobId: job.id }, 'sensor export failed');
        await this.readings.prisma.sensorExportJob.update({ where: { id: job.id }, data: { status: 'FAILED', error: 'The export could not be completed. Please retry or contact support.' } });
      }
    } finally {
      this.running = false;
    }
  }

  private async generate(jobId: string, sensorIds: string[], from: Date, to: Date): Promise<number> {
    const plain = new PassThrough({ highWaterMark: 1 << 20 });
    const gzip = createGzip();
    plain.on('error', () => {});
    gzip.on('error', () => {});
    plain.pipe(gzip);
    const upload = this.objects.uploadStream(`sensor-exports/${jobId}.csv.gz`, gzip, 'application/gzip');
    let uploadError: unknown = null;
    void upload.catch((error) => { uploadError = error; plain.destroy(error); gzip.destroy(error); });
    const write = async (line: string) => {
      if (uploadError) throw uploadError;
      if (!plain.write(line)) await once(plain, 'drain');
    };
    let count = 0;
    try {
      await write(HEADER.join(',') + '\n');
      for await (const row of scanSavedReadings(this.readings, this.objects, from, to, sensorIds)) {
        await write(readingCsvLine(row));
        count += 1;
        if (count % 5_000 === 0) await this.readings.prisma.sensorExportJob.update({ where: { id: jobId }, data: { rowCount: BigInt(count) } });
      }
      await this.readings.prisma.sensorExportJob.update({ where: { id: jobId }, data: { rowCount: BigInt(count) } });
      plain.end();
      await upload;
      return count;
    } catch (error) {
      plain.destroy(error as Error);
      gzip.destroy(error as Error);
      await upload.catch(() => {});
      throw error;
    }
  }
}
