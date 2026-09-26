import { nextUtcDay, utcDay } from './schema.js';
import type { G7ParsedMessage } from '../protocol/g7Types.js';
import type { NormalizedState } from '../sensors/sensorService.js';
import type { OracleObjects } from './oracleObjects.js';

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

type StoredFrame = {
  packetId: string;
  receivedAt: string;
  readings: Omit<RecordedReading, 'receivedAt' | 'packetId'>[];
};

const PREFIX = 'sensor-live/v1/';
const MAX_FRAME_BYTES = 1_048_576;

function frameKey(at: Date, packetId: string): string {
  return `${PREFIX}${at.toISOString().slice(0, 10)}/${String(at.getTime()).padStart(13, '0')}-${packetId}.json`;
}

async function readFrame(objects: OracleObjects, key: string): Promise<StoredFrame> {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of await objects.readStream(key)) {
    const bytes = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += bytes.length;
    if (size > MAX_FRAME_BYTES) throw new Error(`Oversized Oracle sensor object: ${key}`);
    parts.push(bytes);
  }
  const frame = JSON.parse(Buffer.concat(parts).toString('utf8')) as StoredFrame;
  if (!frame.packetId || !Number.isFinite(Date.parse(frame.receivedAt)) || !Array.isArray(frame.readings)) {
    throw new Error(`Invalid Oracle sensor object: ${key}`);
  }
  return frame;
}

/** One durable Oracle object per accepted G7 frame; no backend disk writes. */
export class ObjectReadingJournal {
  constructor(private objects: OracleObjects) {
    if (!objects.enabled) throw new Error('Oracle Object Storage is required for sensor readings');
  }

  async captureMessage(msg: G7ParsedMessage, normalized: NormalizedState, packetId: string): Promise<number> {
    const receivedAt = new Date(normalized.lastMessageAt);
    const readings: StoredFrame['readings'] = Object.entries(normalized.sensors).sort(([a], [b]) => a.localeCompare(b)).map(([sensorId, value]) => {
      const rawFields: Record<string, string> = {};
      for (const prefix of ['A', 'H', 'B', 'K']) {
        const field = `${prefix}${sensorId}`;
        if (msg.fields[field] !== undefined) rawFields[field] = msg.fields[field];
      }
      return {
        stationId: msg.stationId, sensorId, deviceTimeRaw: msg.timestamp ?? null,
        temperature: value.temperature ?? null, temperature2: value.temperature2 ?? null,
        humidity: value.humidity ?? null, secondary: value.secondary ?? null,
        battery: value.battery ?? null, rawStatus: value.rawStatus ?? null, rawFields,
      };
    });
    if (!readings.length) return 0;
    const frame: StoredFrame = { packetId, receivedAt: receivedAt.toISOString(), readings };
    const bytes = Buffer.from(JSON.stringify(frame));
    if (bytes.length > MAX_FRAME_BYTES) throw new Error('Sensor frame exceeds Oracle object size limit');
    await this.objects.putBytes(frameKey(receivedAt, packetId), bytes, 'application/json');
    return readings.length;
  }

  async *scan(from: Date, to: Date, sensorIds: string[] = []): AsyncGenerator<RecordedReading> {
    const wanted = new Set(sensorIds);
    for (let day = utcDay(from); day < to; day = nextUtcDay(day)) {
      for await (const key of this.objects.listKeys(`${PREFIX}${day.toISOString().slice(0, 10)}/`)) {
        const frame = await readFrame(this.objects, key);
        const receivedAt = new Date(frame.receivedAt);
        if (receivedAt < from || receivedAt >= to) continue;
        for (const row of frame.readings) {
          if (wanted.size && !wanted.has(row.sensorId)) continue;
          yield { ...row, packetId: frame.packetId, receivedAt };
        }
      }
    }
  }

  async availability(sensorIds: string[]): Promise<{ first: Date | null; last: Date | null }> {
    let first: Date | null = null;
    let last: Date | null = null;
    const wanted = new Set(sensorIds);
    for await (const key of this.objects.listKeys(PREFIX)) {
      const match = /^sensor-live\/v1\/\d{4}-\d{2}-\d{2}\/(\d{13})-[\w-]+\.json$/.exec(key);
      if (!match) continue;
      if (wanted.size) {
        const frame = await readFrame(this.objects, key);
        if (!frame.readings.some((row) => wanted.has(row.sensorId))) continue;
      }
      const at = new Date(Number(match[1]));
      if (!first || at < first) first = at;
      if (!last || at > last) last = at;
    }
    return { first, last };
  }
}
