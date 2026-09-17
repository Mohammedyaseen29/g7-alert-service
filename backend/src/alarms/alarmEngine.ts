import type { NormalizedState } from '../sensors/sensorService.js';
import type { AlarmConfig } from './alarmTypes.js';

export type AlarmKind = 'temp_high' | 'temp_low' | 'temp2_high' | 'temp2_low' | 'humidity_high' | 'humidity_low' | 'battery_low' | 'sensor_disconnected';
export type AlarmLifecycle = 'NORMAL' | 'PENDING' | 'ALARM' | 'RECOVERED';

export interface AlarmEvent {
  id: string;
  stationId: string;
  sensorId: string;
  kind: AlarmKind;
  lifecycle: AlarmLifecycle;
  value?: number;
  threshold?: number;
  startedAt: string;
  recoveredAt?: string;
  lastNotifiedAt?: string;
  message: string;
}

interface KeyState {
  lifecycle: AlarmLifecycle;
  pendingSince?: number;
  activeEvent?: AlarmEvent;
}

const key = (s: string, k: AlarmKind) => `${s}:${k}`;

export interface EngineOpts {
  now?: () => number;
  uuid?: () => string;
}

export class AlarmEngine {
  private states = new Map<string, KeyState>();
  active = new Map<string, AlarmEvent>(); // key -> event in ALARM
  history: AlarmEvent[] = [];

  constructor(private getConfig: (sensorId: string) => AlarmConfig, private opts: EngineOpts = {}) {}

  private tnow() {
    return (this.opts.now ?? Date.now)();
  }

  private nid() {
    return (this.opts.uuid ?? (() => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`))();
  }

  evaluate(state: NormalizedState): { triggered: AlarmEvent[]; recovered: AlarmEvent[] } {
    const triggered: AlarmEvent[] = [];
    const recovered: AlarmEvent[] = [];
    const now = this.tnow();
    const iso = new Date(now).toISOString();

    for (const [sensorId, reading] of Object.entries(state.sensors)) {
      const cfg = this.getConfig(sensorId);
      const delayMs = (cfg.delaySeconds ?? 300) * 1000;
      const checks: { kind: AlarmKind; breached: boolean; value?: number; threshold?: number; enabled: boolean; label: string }[] = [
        { kind: 'temp_high', breached: Boolean(reading.temperature !== undefined && cfg.temperature?.enabled && cfg.temperature.high !== undefined && reading.temperature > cfg.temperature.high), value: reading.temperature, threshold: cfg.temperature?.high, enabled: Boolean(cfg.temperature?.enabled), label: 'High Temperature' },
        { kind: 'temp_low', breached: Boolean(reading.temperature !== undefined && cfg.temperature?.enabled && cfg.temperature.low !== undefined && reading.temperature < cfg.temperature.low), value: reading.temperature, threshold: cfg.temperature?.low, enabled: Boolean(cfg.temperature?.enabled), label: 'Low Temperature' },
        { kind: 'temp2_high', breached: Boolean(reading.temperature2 !== undefined && cfg.temperature?.enabled && cfg.temperature.high !== undefined && reading.temperature2 > cfg.temperature.high), value: reading.temperature2, threshold: cfg.temperature?.high, enabled: Boolean(cfg.temperature?.enabled), label: 'High Temperature (Channel 2)' },
        { kind: 'temp2_low', breached: Boolean(reading.temperature2 !== undefined && cfg.temperature?.enabled && cfg.temperature.low !== undefined && reading.temperature2 < cfg.temperature.low), value: reading.temperature2, threshold: cfg.temperature?.low, enabled: Boolean(cfg.temperature?.enabled), label: 'Low Temperature (Channel 2)' },
        { kind: 'humidity_high', breached: Boolean(reading.humidity !== undefined && cfg.humidity?.enabled && cfg.humidity.high !== undefined && reading.humidity > cfg.humidity.high), value: reading.humidity, threshold: cfg.humidity?.high, enabled: Boolean(cfg.humidity?.enabled), label: 'High Humidity' },
        { kind: 'humidity_low', breached: Boolean(reading.humidity !== undefined && cfg.humidity?.enabled && cfg.humidity.low !== undefined && reading.humidity < cfg.humidity.low), value: reading.humidity, threshold: cfg.humidity?.low, enabled: Boolean(cfg.humidity?.enabled), label: 'Low Humidity' },
        { kind: 'battery_low', breached: Boolean(reading.battery !== undefined && cfg.battery?.enabled && cfg.battery.low !== undefined && reading.battery < cfg.battery.low), value: reading.battery, threshold: cfg.battery?.low, enabled: Boolean(cfg.battery?.enabled), label: 'Low Battery' },
      ];
      for (const c of checks) {
        if (!c.enabled) {
          this.recover(key(sensorId, c.kind), iso, recovered);
          continue;
        }
        if (c.breached) this.progress(key(sensorId, c.kind), state.stationId, sensorId, c.kind, c.value, c.threshold, `${c.label}: ${c.value} vs ${c.threshold}`, now, iso, delayMs, triggered);
        else this.recover(key(sensorId, c.kind), iso, recovered);
      }
    }
    // Disconnection Check uses lastSeen vs timeout — caller invokes checkTimeouts().
    return { triggered, recovered };
  }

  checkTimeouts(state: NormalizedState, timeoutSeconds: number): { triggered: AlarmEvent[]; recovered: AlarmEvent[] } {
    const triggered: AlarmEvent[] = [];
    const recovered: AlarmEvent[] = [];
    const now = this.tnow();
    const iso = new Date(now).toISOString();
    // Only evaluate sensors we have config for (those seen at least once or in getConfig scope).
    const sensorIds = new Set<string>([...Object.keys(state.sensors), ...this.knownSensors()]);
    for (const sensorId of sensorIds) {
      const cfg = this.getConfig(sensorId);
      if (!cfg.comm?.enabled) continue;
      const reading = state.sensors[sensorId];
      const lastSeen = reading ? Date.parse(reading.lastSeen) : 0;
      const stale = !reading || now - lastSeen > timeoutSeconds * 1000;
      const k = key(sensorId, 'sensor_disconnected');
      const delayMs = (cfg.delaySeconds ?? 300) * 1000;
      if (stale && (reading || this.states.has(k))) {
        this.progress(k, state.stationId, sensorId, 'sensor_disconnected', undefined, undefined, `Sensor ${sensorId} disconnected`, now, iso, delayMs, triggered);
      } else if (!stale) {
        this.recover(k, iso, recovered);
      }
    }
    return { triggered, recovered };
  }

  private knownSensors(): string[] {
    const ids = new Set<string>();
    for (const k of this.states.keys()) ids.add(k.split(':')[0]);
    return [...ids];
  }

  private progress(k: string, stationId: string, sensorId: string, kind: AlarmKind, value: number | undefined, threshold: number | undefined, message: string, now: number, iso: string, delayMs: number, out: AlarmEvent[]) {
    const st = this.states.get(k) ?? { lifecycle: 'NORMAL' as AlarmLifecycle };
    if (st.lifecycle === 'NORMAL' || st.lifecycle === 'RECOVERED') {
      st.lifecycle = 'PENDING';
      st.pendingSince = now;
      this.states.set(k, st);
    }
    if (st.lifecycle === 'PENDING' && now - (st.pendingSince ?? now) >= delayMs) {
      const ev: AlarmEvent = { id: this.nid(), stationId, sensorId, kind, lifecycle: 'ALARM', value, threshold, startedAt: iso, message };
      st.lifecycle = 'ALARM';
      st.activeEvent = ev;
      this.states.set(k, st);
      this.active.set(k, ev);
      this.history.unshift(ev);
      out.push(ev);
    } else if (st.lifecycle === 'ALARM' && st.activeEvent) {
      // Deduplication: stay silent; notifier decides repeat interval via lastNotifiedAt.
    } else {
      this.states.set(k, st);
    }
  }

  private recover(k: string, iso: string, out: AlarmEvent[]) {
    const st = this.states.get(k);
    if (!st) return;
    if (st.lifecycle === 'ALARM' && st.activeEvent) {
      const ev = { ...st.activeEvent, lifecycle: 'RECOVERED' as AlarmLifecycle, recoveredAt: iso };
      this.active.delete(k);
      const idx = this.history.findIndex((h) => h.id === st.activeEvent!.id);
      if (idx >= 0) this.history[idx] = ev;
      out.push(ev);
    }
    this.states.set(k, { lifecycle: 'NORMAL' });
  }

  shouldNotify(ev: AlarmEvent, repeatMinutes: number, now = Date.now()): boolean {
    if (!ev.lastNotifiedAt) return true;
    return now - Date.parse(ev.lastNotifiedAt) >= repeatMinutes * 60 * 1000;
  }

  markNotified(id: string, at = new Date().toISOString()) {
    for (const [k, ev] of this.active) {
      if (ev.id === id) {
        ev.lastNotifiedAt = at;
        const idx = this.history.findIndex((h) => h.id === id);
        if (idx >= 0) this.history[idx] = ev;
      }
    }
  }
}
