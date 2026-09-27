import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SensorReading } from '@prisma/client';
import parquet from 'parquetjs-lite';
import { expect, it, vi } from 'vitest';
import type { OracleObjects } from './oracleObjects.js';
import type { ReadingsStore } from './readingsStore.js';
import { scanSavedReadings } from './historyScan.js';

it('reads only overlapping archive days and combines them with recent readings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'g7-history-scan-test-'));
  try {
    const path = join(directory, 'archive.parquet');
    const schema = new parquet.ParquetSchema({
      receivedAt: { type: 'UTF8' }, packetId: { type: 'UTF8' }, stationId: { type: 'UTF8' },
      sensorId: { type: 'UTF8' }, temperature: { type: 'DOUBLE', optional: true }, rawFields: { type: 'UTF8' },
    });
    const writer = await parquet.ParquetWriter.openFile(schema, path);
    await writer.appendRow({ receivedAt: '2026-01-01T12:00:00.000Z', packetId: 'a', stationId: 'station', sensorId: '01', temperature: 11, rawFields: '{}' });
    await writer.appendRow({ receivedAt: '2026-01-01T12:01:00.000Z', packetId: 'b', stationId: 'station', sensorId: '02', temperature: 99, rawFields: '{}' });
    await writer.close();
    const archive = await readFile(path);
    const day = new Date('2026-01-01T00:00:00.000Z');
    const hot = {
      receivedAt: new Date('2026-01-02T12:00:00.000Z'), packetId: 'c', stationId: 'station', sensorId: '01',
      deviceTimeRaw: null, temperature: 12, temperature2: null, humidity: null, secondary: null,
      battery: null, rawStatus: null, rawFields: {},
    } as SensorReading;
    const scan = vi.fn(async function* () { yield hot; });
    const readings = {
      prisma: { sensorArchiveDay: { findMany: async () => [{ day, objects: {
        files: [{ key: 'old-day.parquet', rows: 2, bytes: archive.length, sha256: createHash('sha256').update(archive).digest('hex') }],
        sensorIds: ['01', '02'], firstBySensor: {}, lastBySensor: {},
      } }] } },
      scan,
    } as unknown as ReadingsStore;
    const downloadFile = vi.fn(async (_key: string, destination: string) => writeFile(destination, archive));
    const objects = { enabled: true, downloadFile } as unknown as OracleObjects;

    const rows: SensorReading[] = [];
    for await (const row of scanSavedReadings(readings, objects, day, new Date('2026-01-03T00:00:00.000Z'), ['01'])) rows.push(row);
    expect(rows.map((row) => [row.sensorId, row.temperature])).toEqual([['01', 11], ['01', 12]]);
    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(scan).toHaveBeenCalledTimes(1);

    downloadFile.mockClear();
    const recent: SensorReading[] = [];
    for await (const row of scanSavedReadings(readings, objects, new Date('2026-01-02T00:00:00.000Z'), new Date('2026-01-03T00:00:00.000Z'), ['01'])) recent.push(row);
    expect(recent).toEqual([hot]);
    expect(downloadFile).not.toHaveBeenCalled();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
