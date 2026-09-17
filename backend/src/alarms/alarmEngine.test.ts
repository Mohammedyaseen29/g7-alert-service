import { describe, it, expect } from 'vitest';
import { AlarmEngine } from './alarmEngine.js';
import { DEFAULT_ALARM_CONFIG } from './alarmTypes.js';

const snap = (temp: number) => ({ stationId: '000000', lastMessageAt: new Date().toISOString(), rawMessage: '', sensors: { '02': { temperature: temp, lastSeen: new Date().toISOString() } } }) as never;

describe('Phase 5-6: alarm delay, cooldown, recovery, disconnect', () => {
  it('requires delay before ALARM', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => ({ ...structuredClone(DEFAULT_ALARM_CONFIG), delaySeconds: 300 }), { now: () => now });
    expect(eng.evaluate(snap(35)).triggered).toHaveLength(0); // PENDING
    now += 301_000;
    expect(eng.evaluate(snap(35)).triggered).toHaveLength(1); // ALARM
    expect(eng.evaluate(snap(35)).triggered).toHaveLength(0); // dedup: no repeat per packet
  });
  it('recovers when back under threshold', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => ({ ...structuredClone(DEFAULT_ALARM_CONFIG), delaySeconds: 0 }), { now: () => now });
    eng.evaluate(snap(35));
    expect(eng.evaluate(snap(20)).recovered).toHaveLength(1);
  });
  it('disconnect after timeout, recover on return', () => {
    let now = 1_000_000;
    const eng = new AlarmEngine(() => ({ ...structuredClone(DEFAULT_ALARM_CONFIG), delaySeconds: 0 }), { now: () => now });
    const staleSnap = { stationId: '000000', lastMessageAt: new Date(now - 200_000).toISOString(), rawMessage: '', sensors: { '02': { temperature: 25, lastSeen: new Date(now - 200_000).toISOString() } } } as never;
    expect(eng.checkTimeouts(staleSnap, 120).triggered[0].kind).toBe('sensor_disconnected');
    const fresh = { stationId: '000000', lastMessageAt: new Date(now).toISOString(), rawMessage: '', sensors: { '02': { temperature: 25, lastSeen: new Date(now).toISOString() } } } as never;
    expect(eng.checkTimeouts(fresh, 120).recovered[0].kind).toBe('sensor_disconnected');
  });
});
