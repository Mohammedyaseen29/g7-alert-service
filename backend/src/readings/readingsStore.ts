import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient, SensorReading } from '@prisma/client';
import type { G7ParsedMessage } from '../protocol/g7Types.js';
import type { NormalizedState } from '../sensors/sensorService.js';
import { ensureDayPartition, nextUtcDay, utcDay } from './schema.js';

export type Reading = SensorReading;

export interface ReadingCursor {
  receivedAt: Date;
  packetId: string;
  sensorId: string;
}

export class ReadingsStore {
  constructor(readonly prisma: PrismaClient) {}

  async capture(msg: G7ParsedMessage, normalized: NormalizedState, packetId: string = randomUUID()): Promise<number> {
    const receivedAt = new Date(normalized.lastMessageAt);
    const data: Prisma.SensorReadingCreateManyInput[] = Object.entries(normalized.sensors).map(([sensorId, value]) => {
      const rawFields: Record<string, string> = {};
      for (const prefix of ['A', 'H', 'B', 'K']) {
        const field = `${prefix}${sensorId}`;
        if (msg.fields[field] !== undefined) rawFields[field] = msg.fields[field];
      }
      return {
        receivedAt, packetId, stationId: msg.stationId, sensorId,
        deviceTimeRaw: msg.timestamp ?? null,
        temperature: value.temperature ?? null,
        temperature2: value.temperature2 ?? null,
        humidity: value.humidity ?? null,
        secondary: value.secondary ?? null,
        battery: value.battery ?? null,
        rawStatus: value.rawStatus ?? null,
        rawFields,
      };
    });
    if (data.length === 0) return 0;
    await ensureDayPartition(this.prisma, receivedAt);
    const result = await this.prisma.sensorReading.createMany({ data, skipDuplicates: true });
    return result.count;
  }

  async page(from: Date, to: Date, sensorIds: string[], cursor?: ReadingCursor, take = 1000): Promise<Reading[]> {
    const where: Prisma.SensorReadingWhereInput = {
      receivedAt: { gte: from, lt: to },
      ...(sensorIds.length ? { sensorId: { in: sensorIds } } : {}),
    };
    return this.prisma.sensorReading.findMany({
      where,
      orderBy: [{ receivedAt: 'asc' }, { packetId: 'asc' }, { sensorId: 'asc' }],
      take,
      ...(cursor ? { cursor: { receivedAt_packetId_sensorId: cursor }, skip: 1 } : {}),
    });
  }

  async *scan(from: Date, to: Date, sensorIds: string[] = []): AsyncGenerator<Reading> {
    let cursor: ReadingCursor | undefined;
    for (;;) {
      const rows = await this.page(from, to, sensorIds, cursor);
      if (!rows.length) return;
      for (const row of rows) yield row;
      const last = rows.at(-1)!;
      cursor = { receivedAt: last.receivedAt, packetId: last.packetId, sensorId: last.sensorId };
    }
  }

  async availability(sensorIds: string[]): Promise<{ first: Date | null; last: Date | null }> {
    const where = sensorIds.length ? { sensorId: { in: sensorIds } } : {};
    const [first, last] = await Promise.all([
      this.prisma.sensorReading.findFirst({ where, orderBy: { receivedAt: 'asc' }, select: { receivedAt: true } }),
      this.prisma.sensorReading.findFirst({ where, orderBy: { receivedAt: 'desc' }, select: { receivedAt: true } }),
    ]);
    const archived = await this.prisma.sensorArchiveDay.findMany({ orderBy: { day: 'asc' } });
    const eligible = archived.filter((entry) => {
      const info = entry.objects as unknown as { sensorIds?: string[] };
      return sensorIds.length === 0 || sensorIds.some((id) => info.sensorIds?.includes(id));
    });
    const archivedTimes = eligible.flatMap((entry) => {
      const info = entry.objects as unknown as { firstBySensor?: Record<string, string>; lastBySensor?: Record<string, string> };
      const ids = sensorIds.length ? sensorIds : Object.keys(info.firstBySensor ?? {});
      return ids.flatMap((id) => [info.firstBySensor?.[id], info.lastBySensor?.[id]])
        .filter((value): value is string => Boolean(value)).map((value) => new Date(value));
    });
    const earliest = [first?.receivedAt, ...archivedTimes].filter((date): date is Date => Boolean(date)).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const latest = [last?.receivedAt, ...archivedTimes].filter((date): date is Date => Boolean(date)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return { first: earliest, last: latest };
  }

  async daysBefore(cutoff: Date): Promise<Date[]> {
    const rows = await this.prisma.$queryRaw<Array<{ name: string }>>`
      SELECT child.relname AS name FROM pg_inherits i
      JOIN pg_class child ON child.oid = i.inhrelid
      JOIN pg_class parent ON parent.oid = i.inhparent
      WHERE parent.relname = 'sensor_readings' AND child.relname LIKE 'sensor_readings_%'
    `;
    return rows.map(({ name }) => /^sensor_readings_(\d{4})(\d{2})(\d{2})$/.exec(name))
      .filter((match): match is RegExpExecArray => Boolean(match))
      .map((match) => new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00.000Z`))
      .filter((day) => nextUtcDay(day) <= utcDay(cutoff))
      .sort((a, b) => a.getTime() - b.getTime());
  }
}
