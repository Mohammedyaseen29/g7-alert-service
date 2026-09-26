import { describe, it, expect } from 'vitest';
import { AlarmEngine, MIN_ALARM_DELAY_MS } from './alarmEngine.js';
import { DEFAULT_ALARM_CONFIG } from './alarmTypes.js';

const snap = (temp: number, at: number) => ({ stationId: '000000', lastMessageAt: new Date(at).toISOString(), rawMessage: '', sensors: { '02': { temperature: temp, lastSeen: new Date(at).toISOString() } } }) as never;

describe('confirmed alarms', () => {
  it('waits for 15 continuous minutes even when an older configuration has a shorter delay', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => ({ ...structuredClone(DEFAULT_ALARM_CONFIG), delaySeconds: 0 }), { now: () => now });
    expect(eng.evaluate(snap(35, now), 120).triggered).toHaveLength(0);
    now += MIN_ALARM_DELAY_MS - 1;
    expect(eng.evaluate(snap(35, now), 120).triggered).toHaveLength(0);
    now += 1;
    expect(eng.evaluate(snap(35, now), 120).triggered).toHaveLength(1);
    expect(eng.evaluate(snap(35, now), 120).triggered).toHaveLength(0);
  });

  it('cancels a short breach and starts a new 15-minute period', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => structuredClone(DEFAULT_ALARM_CONFIG), { now: () => now });
    eng.evaluate(snap(5, now), 120);
    now += 10 * 60_000;
    eng.evaluate(snap(20, now), 120);
    now += 1;
    expect(eng.evaluate(snap(5, now), 120).triggered).toHaveLength(0);
    now += 10 * 60_000;
    expect(eng.evaluate(snap(5, now), 120).triggered).toHaveLength(0);
    now += 5 * 60_000;
    expect(eng.evaluate(snap(5, now), 120).triggered).toHaveLength(1);
  });

  it('does not confirm a temperature breach from stale readings', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => structuredClone(DEFAULT_ALARM_CONFIG), { now: () => now });
    eng.evaluate(snap(35, now), 120);
    const oldAt = now;
    now += MIN_ALARM_DELAY_MS;
    expect(eng.evaluate(snap(35, oldAt), 120).triggered).toHaveLength(0);
    expect(eng.evaluate(snap(35, now), 120).triggered).toHaveLength(0);
    now += MIN_ALARM_DELAY_MS;
    expect(eng.evaluate(snap(35, now), 120).triggered).toHaveLength(1);
  });

  it('recovers when a confirmed alarm returns inside the limit', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => structuredClone(DEFAULT_ALARM_CONFIG), { now: () => now });
    eng.evaluate(snap(35, now), 120);
    now += MIN_ALARM_DELAY_MS;
    eng.evaluate(snap(35, now), 120);
    expect(eng.evaluate(snap(20, now), 120).recovered).toHaveLength(1);
  });

  it('waits 15 minutes after a sensor is detected as disconnected', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => structuredClone(DEFAULT_ALARM_CONFIG), { now: () => now });
    const lastSeen = now - 200_000;
    expect(eng.checkTimeouts(snap(25, lastSeen), 120).triggered).toHaveLength(0);
    now += MIN_ALARM_DELAY_MS;
    expect(eng.checkTimeouts(snap(25, lastSeen), 120).triggered[0].kind).toBe('sensor_disconnected');
    expect(eng.checkTimeouts(snap(25, now), 120).recovered[0].kind).toBe('sensor_disconnected');
  });

  it('keeps the disconnect timer while other frames evaluate stale sensors', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => structuredClone(DEFAULT_ALARM_CONFIG), { now: () => now });
    const stale = snap(25, now - 200_000);
    eng.checkTimeouts(stale, 120);
    for (let minute = 1; minute <= 15; minute += 1) {
      now += 60_000;
      eng.evaluate(stale, 120);
      const result = eng.checkTimeouts(stale, 120);
      expect(result.triggered).toHaveLength(minute === 15 ? 1 : 0);
    }
  });
});
