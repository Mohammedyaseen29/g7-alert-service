import type { PrismaClient } from '@prisma/client';

const readyDays = new Set<string>();

export function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function nextUtcDay(value: Date): Date {
  return new Date(utcDay(value).getTime() + 86_400_000);
}

export function partitionName(day: Date): string {
  return `sensor_readings_${utcDay(day).toISOString().slice(0, 10).replace(/-/g, '')}`;
}

export async function ensureReadingsSchema(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sensor_readings (
      "receivedAt" TIMESTAMPTZ(3) NOT NULL,
      "packetId" UUID NOT NULL,
      "stationId" TEXT NOT NULL,
      "sensorId" TEXT NOT NULL,
      "deviceTimeRaw" TEXT,
      temperature DOUBLE PRECISION,
      temperature2 DOUBLE PRECISION,
      humidity DOUBLE PRECISION,
      secondary DOUBLE PRECISION,
      battery DOUBLE PRECISION,
      "rawStatus" TEXT,
      "rawFields" JSONB NOT NULL,
      PRIMARY KEY ("receivedAt", "packetId", "sensorId")
    ) PARTITION BY RANGE ("receivedAt")
  `);
  const partitioned = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(`
    SELECT EXISTS (
      SELECT 1 FROM pg_partitioned_table p
      JOIN pg_class c ON c.oid = p.partrelid
      WHERE c.relname = 'sensor_readings'
    ) AS exists
  `);
  if (!partitioned[0]?.exists) throw new Error('sensor_readings must be a partitioned table; apply the history migration before starting');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS sensor_readings_sensor_time_idx ON sensor_readings ("sensorId", "receivedAt")');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sensor_archive_days (
      day DATE PRIMARY KEY,
      objects JSONB NOT NULL,
      "rowCount" BIGINT NOT NULL,
      "completedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS sensor_export_jobs (
      id UUID PRIMARY KEY,
      "requestedBy" TEXT NOT NULL,
      "sensorIds" JSONB NOT NULL,
      "from" TIMESTAMPTZ(3) NOT NULL,
      "to" TIMESTAMPTZ(3) NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING',
      "objectKey" TEXT,
      "rowCount" BIGINT,
      error TEXT,
      "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS sensor_export_jobs_requestedBy_createdAt_idx ON sensor_export_jobs ("requestedBy", "createdAt")');
  await ensureDayPartition(prisma, new Date());
  await ensureDayPartition(prisma, nextUtcDay(new Date()));
}

export async function ensureDayPartition(prisma: PrismaClient, day: Date): Promise<void> {
  const start = utcDay(day);
  const key = start.toISOString().slice(0, 10);
  if (readyDays.has(key)) return;
  const end = nextUtcDay(start);
  const name = partitionName(start);
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF sensor_readings FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`);
  readyDays.add(key);
}
