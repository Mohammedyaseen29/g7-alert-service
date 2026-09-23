import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IngestSpool } from './ingestSpool.js';

describe('sensor ingest spool', () => {
  it('replays the same frame ID after processing fails and the process restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'g7-spool-test-'));
    try {
      const first = await IngestSpool.open(directory, 1024 * 1024);
      let packetId = '';
      await expect(first.accept('#STA:test;#', async (frame) => {
        packetId = frame.packetId;
        throw new Error('database unavailable');
      })).rejects.toThrow('database unavailable');
      expect(first.pendingBytes).toBeGreaterThan(0);
      await first.close();

      const second = await IngestSpool.open(directory, 1024 * 1024);
      const replayed: string[] = [];
      await second.replay(async (frame) => { replayed.push(frame.packetId); });
      expect(replayed).toEqual([packetId]);
      expect(second.pendingBytes).toBe(0);
      await second.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
