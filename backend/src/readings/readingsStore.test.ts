import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import type { G7ParsedMessage } from '../protocol/g7Types.js';
import type { NormalizedState } from '../sensors/sensorService.js';
import { ReadingsStore } from './readingsStore.js';

const message = {
  stationId: '000000', timestamp: '320512120000',
  fields: { A01: '24.5', H01: '40.0', A02: '25.5' },
} as G7ParsedMessage;
const state: NormalizedState = {
  stationId: '000000', lastMessageAt: '2032-05-12T12:00:00.000Z', rawMessage: '',
  sensors: {
    '01': { temperature: 24.5, humidity: 40, lastSeen: '2032-05-12T12:00:00.000Z' },
    '02': { temperature: 25.5, lastSeen: '2032-05-12T12:00:00.000Z' },
  },
};
const packetId = '00000000-0000-4000-8000-000000000001';

describe('PostgreSQL sensor reading store', () => {
  it('persists all readings in one frame before reporting success', async () => {
    const execute = vi.fn(async () => undefined);
    const createMany = vi.fn(async ({ data }: { data: unknown[] }) => ({ count: data.length }));
    const store = new ReadingsStore({ $executeRawUnsafe: execute, sensorReading: { createMany } } as unknown as PrismaClient);

    expect(await store.captureMessage(message, state, packetId)).toBe(2);
    expect(execute).toHaveBeenCalledBefore(createMany);
    expect(createMany).toHaveBeenCalledWith({
      skipDuplicates: true,
      data: [
        expect.objectContaining({
          receivedAt: new Date(state.lastMessageAt), packetId, stationId: '000000', sensorId: '01',
          temperature: 24.5, humidity: 40, rawFields: { A01: '24.5', H01: '40.0' },
        }),
        expect.objectContaining({
          receivedAt: new Date(state.lastMessageAt), packetId, stationId: '000000', sensorId: '02',
          temperature: 25.5, rawFields: { A02: '25.5' },
        }),
      ],
    });
  });

  it('never accepts a frame when its database partition cannot be prepared', async () => {
    const createMany = vi.fn();
    const store = new ReadingsStore({
      $executeRawUnsafe: async () => { throw new Error('database unavailable'); },
      sensorReading: { createMany },
    } as unknown as PrismaClient);
    await expect(store.captureMessage(message, { ...state, lastMessageAt: '2032-05-13T12:00:00.000Z' }, packetId))
      .rejects.toThrow('database unavailable');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('selects only complete UTC partitions outside the retention window', async () => {
    const store = new ReadingsStore({
      $queryRaw: async () => [
        { name: 'sensor_readings_20320410' },
        { name: 'sensor_readings_20320411' },
        { name: 'sensor_readings_20320412' },
      ],
    } as unknown as PrismaClient);
    expect((await store.daysBefore(new Date('2032-04-12T23:59:00.000Z'))).map((day) => day.toISOString()))
      .toEqual(['2032-04-10T00:00:00.000Z', '2032-04-11T00:00:00.000Z']);
  });

  it('waits for an in-flight history scan before allowing archive deletion', async () => {
    const store = new ReadingsStore({} as PrismaClient);
    const release = store.beginHistoryRead();
    let finished = false;
    const waiting = store.waitForHistoryReads().then(() => { finished = true; });
    await Promise.resolve();
    expect(finished).toBe(false);
    release();
    await waiting;
    expect(finished).toBe(true);
  });
});
