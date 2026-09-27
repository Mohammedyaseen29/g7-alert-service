import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SensorReading } from '@prisma/client';
import parquet from 'parquetjs-lite';
import { type ArchiveManifest, readParquetRow } from './archive.js';
import type { OracleObjects } from './oracleObjects.js';
import type { ReadingsStore } from './readingsStore.js';
import { nextUtcDay, utcDay } from './schema.js';

async function verifySha256(path: string, expected: string): Promise<void> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  if (hash.digest('hex') !== expected) throw new Error('Archived sensor readings failed their checksum');
}

/** Reads only the days and sensors requested, keeping one archive file on disk at a time. */
export async function* scanSavedReadings(
  readings: ReadingsStore,
  objects: OracleObjects,
  from: Date,
  to: Date,
  sensorIds: string[],
): AsyncGenerator<SensorReading> {
  const wanted = new Set(sensorIds);
  const archives = await readings.prisma.sensorArchiveDay.findMany({
    where: { day: { gte: utcDay(from), lt: to } },
  });
  const byDay = new Map(archives.map((archive) => [utcDay(archive.day).getTime(), archive.objects as unknown as ArchiveManifest]));

  for (let day = utcDay(from); day < to; day = nextUtcDay(day)) {
    const rangeStart = new Date(Math.max(day.getTime(), from.getTime()));
    const rangeEnd = new Date(Math.min(nextUtcDay(day).getTime(), to.getTime()));
    const manifest = byDay.get(day.getTime());
    if (!manifest) {
      for await (const row of readings.scan(rangeStart, rangeEnd, sensorIds)) yield row;
      continue;
    }
    if (wanted.size && manifest.sensorIds?.length && !manifest.sensorIds.some((id) => wanted.has(id))) continue;
    if (!objects.enabled) throw new Error('Archived sensor readings require Oracle Object Storage');

    for (const file of manifest.files) {
      const directory = await mkdtemp(join(tmpdir(), 'g7-report-archive-'));
      const path = join(directory, 'readings.parquet');
      try {
        await objects.downloadFile(file.key, path);
        await verifySha256(path, file.sha256);
        const reader = await parquet.ParquetReader.openFile(path);
        try {
          const cursor = reader.getCursor();
          for (let record = await cursor.next(); record; record = await cursor.next()) {
            const row = readParquetRow(record);
            if (row.receivedAt < rangeStart || row.receivedAt >= rangeEnd) continue;
            if (wanted.size && !wanted.has(row.sensorId)) continue;
            yield row;
          }
        } finally {
          await reader.close();
        }
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
