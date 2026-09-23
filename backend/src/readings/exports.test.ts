import { expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import type { Readable } from 'node:stream';
import type { SensorReading } from '@prisma/client';
import { SensorExports } from './exports.js';
import type { ReadingsStore } from './readingsStore.js';
import type { OracleObjects } from './oracleObjects.js';

it('builds a compressed CSV in the background without loading the reading set at once', async () => {
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
  let uploaded = Buffer.alloc(0);
  const objects = {
    enabled: true,
    uploadStream: async (_key: string, stream: Readable) => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      uploaded = Buffer.concat(chunks);
    },
  } as unknown as OracleObjects;
  const exports = new SensorExports(readings, objects);
  await (exports as unknown as { processOne(): Promise<void> }).processOne();
  expect(job.status).toBe('DONE');
  expect(job.rowCount).toBe(1n);
  const csv = gunzipSync(uploaded).toString('utf8');
  expect(csv).toContain('station_id,sensor_id,received_at_utc');
  expect(csv).toContain('000000,02,2026-01-02T09:10:11.000Z,260102091011,0');
});
