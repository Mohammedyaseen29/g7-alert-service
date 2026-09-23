import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Prisma, SensorReading } from '@prisma/client';
import parquet from 'parquetjs-lite';
import { logger } from '../config/logger.js';
import { OracleObjects } from './oracleObjects.js';
import { ReadingsStore } from './readingsStore.js';
import { nextUtcDay, partitionName, utcDay } from './schema.js';

const FILE_ROWS = 50_000;

export interface ArchiveFile {
  key: string;
  rows: number;
  bytes: number;
  sha256: string;
}

export interface ArchiveManifest {
  files: ArchiveFile[];
  sensorIds: string[];
  firstBySensor: Record<string, string>;
  lastBySensor: Record<string, string>;
}

const fields = {
  receivedAt: { type: 'UTF8', compression: 'SNAPPY' },
  packetId: { type: 'UTF8', compression: 'SNAPPY' },
  stationId: { type: 'UTF8', compression: 'SNAPPY' },
  sensorId: { type: 'UTF8', compression: 'SNAPPY' },
  deviceTimeRaw: { type: 'UTF8', optional: true, compression: 'SNAPPY' },
  temperature: { type: 'DOUBLE', optional: true, compression: 'SNAPPY' },
  temperature2: { type: 'DOUBLE', optional: true, compression: 'SNAPPY' },
  humidity: { type: 'DOUBLE', optional: true, compression: 'SNAPPY' },
  secondary: { type: 'DOUBLE', optional: true, compression: 'SNAPPY' },
  battery: { type: 'DOUBLE', optional: true, compression: 'SNAPPY' },
  rawStatus: { type: 'UTF8', optional: true, compression: 'SNAPPY' },
  rawFields: { type: 'UTF8', compression: 'SNAPPY' },
};

function parquetRow(row: SensorReading): Record<string, unknown> {
  return {
    receivedAt: row.receivedAt.toISOString(), packetId: row.packetId,
    stationId: row.stationId, sensorId: row.sensorId,
    ...(row.deviceTimeRaw ? { deviceTimeRaw: row.deviceTimeRaw } : {}),
    ...(row.temperature !== null ? { temperature: row.temperature } : {}),
    ...(row.temperature2 !== null ? { temperature2: row.temperature2 } : {}),
    ...(row.humidity !== null ? { humidity: row.humidity } : {}),
    ...(row.secondary !== null ? { secondary: row.secondary } : {}),
    ...(row.battery !== null ? { battery: row.battery } : {}),
    ...(row.rawStatus ? { rawStatus: row.rawStatus } : {}),
    rawFields: JSON.stringify(row.rawFields),
  };
}

export function readParquetRow(row: Record<string, unknown>): SensorReading {
  const numberOrNull = (value: unknown) => typeof value === 'number' ? value : null;
  return {
    receivedAt: new Date(String(row.receivedAt)), packetId: String(row.packetId),
    stationId: String(row.stationId), sensorId: String(row.sensorId),
    deviceTimeRaw: row.deviceTimeRaw ? String(row.deviceTimeRaw) : null,
    temperature: numberOrNull(row.temperature), temperature2: numberOrNull(row.temperature2),
    humidity: numberOrNull(row.humidity), secondary: numberOrNull(row.secondary),
    battery: numberOrNull(row.battery), rawStatus: row.rawStatus ? String(row.rawStatus) : null,
    rawFields: JSON.parse(String(row.rawFields)),
  };
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

export class SensorArchiver {
  constructor(private readings: ReadingsStore, private objects: OracleObjects, private hotDays: number) {}

  async archiveOneDueDay(now = new Date()): Promise<boolean> {
    if (!this.objects.enabled) return false;
    const cutoff = new Date(now.getTime() - this.hotDays * 86_400_000);
    const [day] = await this.readings.daysBefore(cutoff);
    if (!day) return false;
    await this.archiveDay(day);
    return true;
  }

  async archiveDay(dayValue: Date): Promise<void> {
    const day = utcDay(dayValue);
    const prisma = this.readings.prisma;
    const existing = await prisma.sensorArchiveDay.findUnique({ where: { day } });
    if (existing) {
      const manifest = existing.objects as unknown as ArchiveManifest;
      const count = await prisma.sensorReading.count({ where: { receivedAt: { gte: day, lt: nextUtcDay(day) } } });
      if (BigInt(count) !== existing.rowCount) throw new Error(`Archived day ${day.toISOString()} no longer matches its database partition`);
      const verificationDirectory = await mkdtemp(join(tmpdir(), 'g7-archive-verify-'));
      try {
        for (const file of manifest.files) {
          const path = join(verificationDirectory, 'archive.parquet');
          await this.objects.downloadFile(file.key, path);
          if (await sha256(path) !== file.sha256) throw new Error(`Oracle archive checksum mismatch: ${file.key}`);
          await rm(path, { force: true });
        }
      } finally {
        await rm(verificationDirectory, { recursive: true, force: true });
      }
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partitionName(day)}"`);
      return;
    }
    const directory = await mkdtemp(join(tmpdir(), 'g7-sensor-archive-'));
    const manifest: ArchiveManifest = { files: [], sensorIds: [], firstBySensor: {}, lastBySensor: {} };
    let writer: InstanceType<typeof parquet.ParquetWriter> | null = null;
    let filePath = '';
    let fileRows = 0;
    let total = 0;
    const sensorIds = new Set<string>();
    const finishFile = async () => {
      if (!writer) return;
      await writer.close();
      writer = null;
      const key = `sensor-history/${day.toISOString().slice(0, 10)}/part-${String(manifest.files.length).padStart(5, '0')}.parquet`;
      const digest = await sha256(filePath);
      const bytes = await this.objects.uploadFile(key, filePath, 'application/vnd.apache.parquet');
      const verificationPath = join(directory, 'verify.parquet');
      await this.objects.downloadFile(key, verificationPath);
      if (await sha256(verificationPath) !== digest) throw new Error(`Oracle archive checksum mismatch: ${key}`);
      await rm(verificationPath, { force: true });
      manifest.files.push({ key, rows: fileRows, bytes, sha256: digest });
      await rm(filePath, { force: true });
      fileRows = 0;
    };
    try {
      for await (const row of this.readings.scan(day, nextUtcDay(day))) {
        if (!writer) {
          filePath = join(directory, `part-${String(manifest.files.length).padStart(5, '0')}.parquet`);
          writer = await parquet.ParquetWriter.openFile(new parquet.ParquetSchema(fields), filePath);
          writer.setRowGroupSize(8192);
        }
        await writer.appendRow(parquetRow(row));
        sensorIds.add(row.sensorId);
        const time = row.receivedAt.toISOString();
        manifest.firstBySensor[row.sensorId] ??= time;
        manifest.lastBySensor[row.sensorId] = time;
        total += 1;
        fileRows += 1;
        if (fileRows >= FILE_ROWS) await finishFile();
      }
      await finishFile();
      const databaseCount = await prisma.sensorReading.count({ where: { receivedAt: { gte: day, lt: nextUtcDay(day) } } });
      if (databaseCount !== total) throw new Error(`Archive row count mismatch for ${day.toISOString()}: ${total} of ${databaseCount}`);
      manifest.sensorIds = [...sensorIds].sort();
      await prisma.sensorArchiveDay.create({ data: { day, objects: manifest as unknown as Prisma.InputJsonValue, rowCount: BigInt(total) } });
      await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${partitionName(day)}"`);
      logger.info({ day: day.toISOString(), rows: total, files: manifest.files.length }, 'sensor readings archived in Oracle Object Storage');
    } finally {
      if (writer) await writer.close().catch(() => {});
      await rm(directory, { recursive: true, force: true });
    }
  }
}
