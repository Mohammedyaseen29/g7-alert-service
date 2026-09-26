import { appendFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { LocalReadingJournal, type RecordedReading } from './localJournal.js';

function reading(packetId: string, at: string): RecordedReading {
  return {
    packetId, receivedAt: new Date(at), stationId: '000000', sensorId: '02', deviceTimeRaw: null,
    temperature: 7.5, temperature2: null, humidity: 66, secondary: null, battery: 3.6,
    rawStatus: null, rawFields: { A02: '7.5' },
  };
}

it('keeps raw readings on disk and ignores a replayed packet after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tempmo-journal-'));
  try {
    const first = new LocalReadingJournal(directory);
    const row = reading('packet-one', '2026-09-26T10:00:00.000Z');
    expect(await first.capture([row], row.packetId)).toBe(1);
    const restarted = new LocalReadingJournal(directory);
    expect(await restarted.capture([row], row.packetId)).toBe(0);
    const rows = [];
    for await (const saved of restarted.scan(new Date('2026-09-26T00:00:00.000Z'), new Date('2026-09-27T00:00:00.000Z'), ['02'])) rows.push(saved);
    expect(rows).toHaveLength(1);
    expect(rows[0].temperature).toBe(7.5);
    expect(await restarted.availability(['02'])).toEqual({ first: row.receivedAt, last: row.receivedAt });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('recovers an incomplete final write before adding the next packet', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'tempmo-journal-'));
  try {
    const first = new LocalReadingJournal(directory);
    await first.capture([reading('packet-one', '2026-09-26T10:00:00.000Z')], 'packet-one');
    await appendFile(join(directory, 'readings-local', '2026-09-26.ndjson'), '{"packetId":"unfinished"');
    const restarted = new LocalReadingJournal(directory);
    await restarted.capture([reading('packet-two', '2026-09-26T10:01:00.000Z')], 'packet-two');
    const rows = [];
    for await (const saved of restarted.scan(new Date('2026-09-26T00:00:00.000Z'), new Date('2026-09-27T00:00:00.000Z'))) rows.push(saved);
    expect(rows.map((row) => row.packetId)).toEqual(['packet-one', 'packet-two']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
