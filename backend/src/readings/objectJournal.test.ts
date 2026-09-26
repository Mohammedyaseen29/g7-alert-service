import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { ObjectReadingJournal } from './objectJournal.js';
import type { OracleObjects } from './oracleObjects.js';
import type { G7ParsedMessage } from '../protocol/g7Types.js';
import type { NormalizedState } from '../sensors/sensorService.js';

function fixture() {
  const files = new Map<string, Buffer>();
  const objects = {
    enabled: true,
    putBytes: async (key: string, bytes: Buffer) => { files.set(key, bytes); },
    async *listKeys(prefix: string) { for (const key of [...files.keys()].sort()) if (key.startsWith(prefix)) yield key; },
    readStream: async (key: string) => Readable.from([files.get(key)!]),
  } as unknown as OracleObjects;
  const message = { stationId: '000000', timestamp: '260926120000', fields: { A01: '24.5', A02: '25.5' } } as G7ParsedMessage;
  const state: NormalizedState = { stationId: '000000', lastMessageAt: '2026-09-26T12:00:00.000Z', rawMessage: '', sensors: {
    '01': { temperature: 24.5, lastSeen: '2026-09-26T12:00:00.000Z' },
    '02': { temperature: 25.5, lastSeen: '2026-09-26T12:00:00.000Z' },
  } };
  return { files, objects, message, state };
}

describe('Oracle object reading journal', () => {
  it('stores one frame remotely and reads selected sensor history', async () => {
    const { files, objects, message, state } = fixture();
    const journal = new ObjectReadingJournal(objects);
    expect(await journal.captureMessage(message, state, 'packet-1')).toBe(2);
    expect(files.size).toBe(1);
    const rows = [];
    for await (const row of journal.scan(new Date('2026-09-26T00:00:00Z'), new Date('2026-09-27T00:00:00Z'), ['02'])) rows.push(row);
    expect(rows).toHaveLength(1);
    expect(rows[0].temperature).toBe(25.5);
    expect(await journal.availability(['02'])).toEqual({ first: new Date(state.lastMessageAt), last: new Date(state.lastMessageAt) });
  });

  it('does not upload or expose an inactive sensor with no normalized reading', async () => {
    const { files, objects, message, state } = fixture();
    state.sensors = {};
    expect(await new ObjectReadingJournal(objects).captureMessage(message, state, 'packet-2')).toBe(0);
    expect(files.size).toBe(0);
  });

  it('fails when the required Oracle destination is unavailable', async () => {
    expect(() => new ObjectReadingJournal({ enabled: false } as OracleObjects)).toThrow('required');
    const { message, state } = fixture();
    const objects = { enabled: true, putBytes: async () => { throw new Error('Oracle unavailable'); } } as unknown as OracleObjects;
    await expect(new ObjectReadingJournal(objects).captureMessage(message, state, 'packet-3')).rejects.toThrow('Oracle unavailable');
  });
});
