import { describe, it, expect } from 'vitest';
import { AlarmConfigSchema } from '../alarms/alarmTypes.js';

describe('Phase 8: config validation (frontend + backend)', () => {
  it('rejects high <= low', () => {
    const r = AlarmConfigSchema.safeParse({ temperature: { high: 10, low: 30, enabled: true } });
    expect(r.success).toBe(false);
  });
  it('accepts valid thresholds', () => {
    const r = AlarmConfigSchema.safeParse({ temperature: { high: 30, low: 10, enabled: true }, humidity: { high: 80, low: 20, enabled: true }, battery: { low: 3.3, enabled: true } });
    expect(r.success).toBe(true);
  });
  it('accepts a configurable alarm delay and rejects zero or an excessive delay', () => {
    expect(AlarmConfigSchema.safeParse({ delaySeconds: 300 }).success).toBe(true);
    expect(AlarmConfigSchema.safeParse({ delaySeconds: 0 }).success).toBe(false);
    expect(AlarmConfigSchema.safeParse({ delaySeconds: 61 }).success).toBe(false);
    expect(AlarmConfigSchema.safeParse({ delaySeconds: 86_401 }).success).toBe(false);
  });
});
