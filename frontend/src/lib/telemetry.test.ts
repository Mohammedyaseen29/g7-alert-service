import { describe, expect, it } from 'vitest';
import type { Sensor } from '../types.js';
import { MAX_TELEMETRY_SAMPLES, recordSensorSamples, sensorHealth, thresholdBreaches, type SensorHistory } from './telemetry.js';

function sensor(overrides: Partial<Sensor> = {}): Sensor {
  return {
    id: '02',
    name: 'Sensor 02',
    type: 'temperature',
    fields: { temperature: 'A02' },
    reading: { temperature: 20, lastSeen: '2026-09-19T06:00:00.000Z' },
    online: true,
    activeAlarmCount: 0,
    ...overrides,
  };
}

describe('telemetry history', () => {
  it('keeps unique real samples ordered and capped at 60', () => {
    const history: SensorHistory = {};
    const first = sensor({ reading: { temperature: 20, lastSeen: '2026-09-19T06:00:02.000Z' } });
    const earlier = sensor({ reading: { temperature: 19, lastSeen: '2026-09-19T06:00:01.000Z' } });

    expect(recordSensorSamples(history, [first])).toBe(true);
    expect(recordSensorSamples(history, [first])).toBe(false);
    expect(recordSensorSamples(history, [earlier])).toBe(true);
    expect(history['02'].map((item) => item.lastSeen)).toEqual([
      '2026-09-19T06:00:01.000Z',
      '2026-09-19T06:00:02.000Z',
    ]);

    const baseTime = Date.parse('2026-09-19T06:01:00.000Z');
    for (let index = 0; index < 65; index += 1) {
      recordSensorSamples(history, [sensor({ reading: { temperature: index, lastSeen: new Date(baseTime + index * 1_000).toISOString() } })]);
    }
    expect(history['02']).toHaveLength(MAX_TELEMETRY_SAMPLES);
    expect(history['02'][0].temperature).toBe(5);
  });
});

describe('sensor classification', () => {
  it('does not classify disabled thresholds as a warning', () => {
    const item = sensor({
      reading: { temperature: 40, lastSeen: '2026-09-19T06:00:00.000Z' },
      thresholds: { temperature: { low: 10, high: 30, enabled: false } },
    });
    expect(thresholdBreaches(item)).toEqual([]);
    expect(sensorHealth(item)).toBe('normal');
  });

  it('classifies an enabled threshold breach while preserving zero readings', () => {
    const item = sensor({
      reading: { temperature: 0, battery: 0, lastSeen: '2026-09-19T06:00:00.000Z' },
      thresholds: { temperature: { low: 10, high: 30, enabled: true }, battery: { low: 3.3, enabled: true } },
    });
    expect(thresholdBreaches(item)).toEqual([
      { channel: 'temperature', direction: 'low', value: 0, threshold: 10 },
      { channel: 'battery', direction: 'low', value: 0, threshold: 3.3 },
    ]);
    expect(sensorHealth(item)).toBe('warning');
  });
});
