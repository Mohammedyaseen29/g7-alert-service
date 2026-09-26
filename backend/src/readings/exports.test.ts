import { expect, it } from 'vitest';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SensorReading } from '@prisma/client';
import { SensorExports } from './exports.js';
import type { ReadingsStore } from './readingsStore.js';
import type { OracleObjects } from './oracleObjects.js';

it('builds a compressed CSV in the background without loading the reading set at once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'g7-export-create-test-'));
  try {
  const row: SensorReading = {
    receivedAt: new Date('2026-01-02T09:10:11.000Z'), packetId: '00000000-0000-4000-8000-000000000001',
    stationId: '000000', sensorId: '02', deviceTimeRaw: '260102091011',
    temperature: 0, temperature2: null, humidity: null, secondary: null,
    battery: 3.2, rawStatus: null, rawFields: { A02: '0.000' },
  };
  const job = {
    id: '00000000-0000-4000-8000-000000000002', sensorIds: ['02'],
    from: new Date('2026-01-02T00:00:00.000Z'), to: new Date('2026-01-03T00:00:00.000Z'),
    status: 'PENDING', rowCount: null as bigint | null, objectKey: null as string | null,
  };
  const prisma = {
    sensorExportJob: {
      findFirst: async () => job.status === 'PENDING' ? job : null,
      updateMany: async () => { job.status = 'PROCESSING'; return { count: 1 }; },
      update: async ({ data }: { data: Partial<typeof job> }) => { Object.assign(job, data); return job; },
    },
    sensorArchiveDay: { findUnique: async () => null },
  };
  const readings = { prisma, async *scan() { yield row; } } as unknown as ReadingsStore;
  const objects = { enabled: false } as OracleObjects;
  const exports = new SensorExports(readings, objects, directory);
  await (exports as unknown as { processOne(): Promise<void> }).processOne();
  expect(job.status).toBe('DONE');
  expect(job.rowCount).toBe(1n);
  expect(job.objectKey).toBe(`local:${job.id}`);
  const csv = gunzipSync(await readFile(join(directory, 'exports', `${job.id}.csv.gz`))).toString('utf8');
  expect(csv).toContain('station_id,sensor_id,received_at_utc');
  expect(csv).toContain('000000,02,2026-01-02T09:10:11.000Z,260102091011,0');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('streams a completed Oracle export as readable CSV only for its owner', async () => {
  const id = '00000000-0000-4000-8000-000000000003';
  const csv = 'station_id,sensor_id,received_at_utc\n000000,02,2026-01-02T09:10:11.000Z\n';
  const compressed = gzipSync(Buffer.from(csv));
  const job = {
    id, requestedBy: 'owner', status: 'DONE',
    objectKey: `sensor-exports/${id}.csv.gz`,
    from: new Date('2026-01-02T00:00:00.000Z'), to: new Date('2026-01-03T00:00:00.000Z'),
  };
  const readings = { prisma: { sensorExportJob: {
    findFirst: async ({ where }: { where: { id: string; requestedBy: string; status: string } }) =>
      where.id === id && where.requestedBy === 'owner' && where.status === 'DONE' ? job : null,
  } } } as unknown as ReadingsStore;
  const objects = { readStream: async (key: string) => {
    expect(key).toBe(job.objectKey);
    return Readable.from([compressed]);
  } } as unknown as OracleObjects;
  const exports = new SensorExports(readings, objects);
  expect(await exports.openDownload(id, 'other')).toBeNull();
  expect(await exports.downloadUrl(id, 'owner')).toBe(`/api/readings/exports/${id}/file`);
  const file = await exports.openDownload(id, 'owner');
  expect(file?.filename).toBe('sensor-readings-2026-01-02-2026-01-03.csv');
  const chunks: Buffer[] = [];
  for await (const chunk of file!.source.pipe(createGunzip())) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString('utf8')).toBe(csv);
});

it('streams a local compressed export as readable CSV', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'g7-export-download-test-'));
  const id = '00000000-0000-4000-8000-000000000004';
  const csv = 'station_id,sensor_id\n000000,02\n';
  try {
    await mkdir(join(directory, 'exports'));
    await writeFile(join(directory, 'exports', `${id}.csv.gz`), gzipSync(Buffer.from(csv)));
    const job = {
      id, status: 'DONE', objectKey: `local:${id}`,
      from: new Date('2026-01-02T00:00:00.000Z'), to: new Date('2026-01-03T00:00:00.000Z'),
    };
    const readings = { prisma: { sensorExportJob: {
      findFirst: async ({ where }: { where: { id: string; requestedBy: string; status: string } }) =>
        where.id === id && where.requestedBy === 'owner' && where.status === 'DONE' ? job : null,
    } } } as unknown as ReadingsStore;
    const exports = new SensorExports(readings, { enabled: false } as OracleObjects, directory);
    const file = await exports.openDownload(id, 'owner');
    expect(file?.filename).toBe('sensor-readings-2026-01-02-2026-01-03.csv');
    const chunks: Buffer[] = [];
    for await (const chunk of file!.source.pipe(createGunzip())) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString('utf8')).toBe(csv);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
