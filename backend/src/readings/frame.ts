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

export function readingsFromFrame(msg: G7ParsedMessage, normalized: NormalizedState, packetId: string): RecordedReading[] {
  const receivedAt = new Date(normalized.lastMessageAt);
  return Object.entries(normalized.sensors).sort(([a], [b]) => a.localeCompare(b)).map(([sensorId, value]) => {
    const rawFields: Record<string, string> = {};
    for (const prefix of ['A', 'H', 'B', 'K']) {
      const field = `${prefix}${sensorId}`;
      if (msg.fields[field] !== undefined) rawFields[field] = msg.fields[field];
    }
    return {
      receivedAt, packetId, stationId: msg.stationId, sensorId, deviceTimeRaw: msg.timestamp ?? null,
      temperature: value.temperature ?? null, temperature2: value.temperature2 ?? null,
      humidity: value.humidity ?? null, secondary: value.secondary ?? null,
      battery: value.battery ?? null, rawStatus: value.rawStatus ?? null, rawFields,
    };
  });
}
