import { createReadStream } from 'node:fs';
import { mkdir, open, readdir, stat, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import { nextUtcDay, utcDay } from './schema.js';
import type { G7ParsedMessage } from '../protocol/g7Types.js';
import type { NormalizedState } from '../sensors/sensorService.js';

export interface RecordedReading {
  receivedAt: Date;
  packetId: string;
  stationId: string;
  sensorId: string;
  deviceTimeRaw: string | null;
  temperature: number | null;
  temperature2: number | null;
  humidity: number | null;
  secondary: number | null;
  battery: number | null;
  rawStatus: string | null;
  rawFields: Record<string, string>;
}

interface JournalRecord {
  packetId: string;
  receivedAt: string;
  readings: Omit<RecordedReading, 'receivedAt' | 'packetId'>[];
}

async function *completeLines(path: string): AsyncGenerator<{ line: string; end: number }> {
  let pending = Buffer.alloc(0);
  let end = 0;
  for await (const chunk of createReadStream(path)) {
    pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    for (;;) {
      const newline = pending.indexOf(10);
      if (newline < 0) break;
      const bytes = pending.subarray(0, newline);
      end += newline + 1;
      yield { line: bytes.toString('utf8'), end };
      pending = pending.subarray(newline + 1);
    }
  }
}

function parseRecord(line: string): JournalRecord {
  const record = JSON.parse(line) as JournalRecord;
  if (!record.packetId || !Number.isFinite(Date.parse(record.receivedAt)) || !Array.isArray(record.readings)) {
    throw new Error('Corrupt local sensor reading journal');
  }
  return record;
}

/** Raw readings stay on the backend host. One fsynced record is written per G7 frame. */
export class LocalReadingJournal {
  private readonly directory: string;
  private readonly seenByDay = new Map<string, Set<string>>();
  private writeChain: Promise<void> = Promise.resolve();

  constructor(dataDir: string) { this.directory = join(dataDir, 'readings-local'); }

  private dayPath(day: string): string { return join(this.directory, `${day}.ndjson`); }

  private async seen(day: string): Promise<Set<string>> {
    const cached = this.seenByDay.get(day);
    if (cached) return cached;
    const ids = new Set<string>();
    const path = this.dayPath(day);
    let size: number;
    try { size = (await stat(path)).size; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      size = 0;
    }
    let completeBytes = 0;
    if (size > 0) {
      for await (const { line, end } of completeLines(path)) {
        ids.add(parseRecord(line).packetId);
        completeBytes = end;
      }
      // A crash can leave an incomplete final line. The spool will replay it.
      if (completeBytes < size) await truncate(path, completeBytes);
    }
    this.seenByDay.set(day, ids);
    if (this.seenByDay.size > 3) this.seenByDay.delete(this.seenByDay.keys().next().value!);
    return ids;
  }

  async capture(rows: RecordedReading[], packetId: string): Promise<number> {
    if (!rows.length) return 0;
    let count = 0;
    const write = this.writeChain.then(async () => {
      const day = rows[0].receivedAt.toISOString().slice(0, 10);
      await mkdir(this.directory, { recursive: true });
      const seen = await this.seen(day);
      if (seen.has(packetId)) return;
      const path = this.dayPath(day);
      const record: JournalRecord = {
        packetId,
        receivedAt: rows[0].receivedAt.toISOString(),
        readings: rows.map(({ receivedAt: _receivedAt, packetId: _packetId, ...row }) => row),
      };
      const bytes = Buffer.from(`${JSON.stringify(record)}\n`);
      const handle = await open(path, 'a+');
      const originalSize = (await handle.stat()).size;
      try {
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written);
          if (!result.bytesWritten) throw new Error('Local sensor journal write made no progress');
          written += result.bytesWritten;
        }
        await handle.sync();
        seen.add(packetId);
        count = rows.length;
      } catch (error) {
        await handle.truncate(originalSize);
        await handle.sync();
        throw error;
      } finally { await handle.close(); }
    });
    this.writeChain = write.then(() => {}, () => {});
    await write;
    return count;
  }

  async captureMessage(msg: G7ParsedMessage, normalized: NormalizedState, packetId: string): Promise<number> {
    const receivedAt = new Date(normalized.lastMessageAt);
    const rows: RecordedReading[] = Object.entries(normalized.sensors).map(([sensorId, value]) => {
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
    return this.capture(rows, packetId);
  }

  async *scan(from: Date, to: Date, sensorIds: string[] = []): AsyncGenerator<RecordedReading> {
    await this.writeChain;
    const wanted = new Set(sensorIds);
    for (let day = utcDay(from); day < to; day = nextUtcDay(day)) {
      const path = this.dayPath(day.toISOString().slice(0, 10));
      try { await stat(path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw error;
      }
      for await (const { line } of completeLines(path)) {
        const record = parseRecord(line);
        const receivedAt = new Date(record.receivedAt);
        if (receivedAt < from || receivedAt >= to) continue;
        for (const row of record.readings) {
          if (wanted.size && !wanted.has(row.sensorId)) continue;
          yield { ...row, packetId: record.packetId, receivedAt };
        }
      }
    }
  }

  async availability(sensorIds: string[]): Promise<{ first: Date | null; last: Date | null }> {
    await this.writeChain;
    let first: Date | null = null;
    let last: Date | null = null;
    const wanted = new Set(sensorIds);
    let names: string[];
    try { names = await readdir(this.directory); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { first, last };
      throw error;
    }
    for (const name of names.filter((value) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(value)).sort()) {
      for await (const { line } of completeLines(join(this.directory, name))) {
        const record = parseRecord(line);
        if (wanted.size && !record.readings.some((row) => wanted.has(row.sensorId))) continue;
        const at = new Date(record.receivedAt);
        if (!first || at < first) first = at;
        if (!last || at > last) last = at;
      }
    }
    return { first, last };
  }
}
