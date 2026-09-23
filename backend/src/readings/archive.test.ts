import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SensorReading } from '@prisma/client';
import parquet from 'parquetjs-lite';
import { SensorArchiver, readParquetRow, type ArchiveManifest } from './archive.js';
import { readingCsvLine } from './exports.js';
import type { ReadingsStore } from './readingsStore.js';
import type { OracleObjects } from './oracleObjects.js';

const day = new Date('2026-01-02T00:00:00.000Z');
const row: SensorReading = {
  receivedAt: new Date('2026-01-02T09:10:11.000Z'), packetId: '00000000-0000-4000-8000-000000000001',
  stationId: '000000', sensorId: '02', deviceTimeRaw: '260102091011',
  temperature: 0, temperature2: null, humidity: 42.5, secondary: null,
  battery: 3.2, rawStatus: '=HYPERLINK("bad")', rawFields: { A02: '0.000', H02: '42.5' },
};

function fixture(failUpload = false) {
  let dropped = false;
  let manifest: ArchiveManifest | null = null;
  const files = new Map<string, Buffer>();
  const prisma = {
    sensorArchiveDay: {
      findUnique: async () => null,
      create: async ({ data }: { data: { objects: ArchiveManifest } }) => { manifest = data.objects; },
    },
    sensorReading: { count: async () => 1 },
    $executeRawUnsafe: async (sql: string) => { if (sql.startsWith('DROP TABLE')) dropped = true; },
  };
  const readings = {
    prisma,
    async *scan() { yield row; },
  } as unknown as ReadingsStore;
  const objects = {
    enabled: true,
    uploadFile: async (key: string, path: string) => {
      if (failUpload) throw new Error('OCI unavailable');
      const bytes = await readFile(path);
      files.set(key, bytes);
      return bytes.length;
    },
    downloadFile: async (key: string, path: string) => { await writeFile(path, files.get(key)!); },
  } as unknown as OracleObjects;
  return { archiver: new SensorArchiver(readings, objects, 90), files, get dropped() { return dropped; }, get manifest() { return manifest; } };
}

describe('sensor archive', () => {
  it('writes and verifies a Parquet object before dropping the database partition', async () => {
    const target = fixture();
    await target.archiver.archiveDay(day);
    expect(target.dropped).toBe(true);
    expect(target.manifest).toMatchObject({ sensorIds: ['02'], firstBySensor: { '02': row.receivedAt.toISOString() } });
    expect(target.files.size).toBe(1);
    expect(target.files.values().next().value?.subarray(0, 4).toString()).toBe('PAR1');
    const directory = await mkdtemp(join(tmpdir(), 'g7-parquet-test-'));
    try {
      const path = join(directory, 'archive.parquet');
      await writeFile(path, target.files.values().next().value!);
      const reader = await parquet.ParquetReader.openFile(path);
      try {
        const restored = readParquetRow((await reader.getCursor().next())!);
        expect(restored).toMatchObject({ sensorId: '02', temperature: 0, humidity: 42.5, rawFields: row.rawFields });
      } finally { await reader.close(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('retains the database partition if Oracle upload fails', async () => {
    const target = fixture(true);
    await expect(target.archiver.archiveDay(day)).rejects.toThrow('OCI unavailable');
    expect(target.dropped).toBe(false);
  });
});

it('exports zero values and neutralizes spreadsheet formulas in text fields', () => {
  const csv = readingCsvLine(row);
  expect(csv).toContain(',0,,42.5,');
  expect(csv).toContain("'=HYPERLINK");
});
