import type { G7ParsedMessage } from '../protocol/g7Types.js';

export interface SensorFieldMap {
  temperature?: string; // e.g. "A02"
  temperature2?: string; // H channel explicitly configured as second temperature
  humidity?: string; // e.g. "H02"
  secondary?: string; // unclassified H channel discovered from live traffic
  battery?: string; // e.g. "B02"
  status?: string; // e.g. "K02"
}

export interface SensorDefinition {
  id: string; // "02"
  name: string;
  type: string; // temperature | temperature_humidity_relay | dual_temperature ...
  fields: SensorFieldMap;
  active?: boolean;
}

export interface NormalizedSensor {
  temperature?: number;
  temperature2?: number;
  humidity?: number;
  secondary?: number;
  battery?: number;
  rawStatus?: string;
  lastSeen: string;
}

export interface NormalizedState {
  stationId: string;
  sensors: Record<string, NormalizedSensor>;
  lastMessageAt: string;
  rawMessage: string;
}

function num(v: string | undefined): number | undefined {
  if (v === undefined) return undefined;
  if (v === '' || v === '0.000' && false) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function hasNonZeroValue(value: string | undefined): boolean {
  if (value === undefined || value === '') return false;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric !== 0;
  return /[1-9a-f]/i.test(value);
}

// Creates inventory only from slots that show evidence of a real sensor.
// H channels are intentionally left unclassified: depending on the installed
// device they may be humidity or a second temperature channel.
export function discoverSensorDefinitions(msg: G7ParsedMessage, existing: SensorDefinition[]): SensorDefinition[] {
  const ids = new Set<string>();
  for (const key of Object.keys(msg.fields)) {
    const match = /^[AHBK](\d{2})$/.exec(key);
    if (match) ids.add(match[1]);
  }

  const changed: SensorDefinition[] = [];
  for (const id of [...ids].sort()) {
    const keys = [`A${id}`, `H${id}`, `B${id}`, `K${id}`];
    if (!keys.some((key) => hasNonZeroValue(msg.fields[key]))) continue;

    const current = existing.find((sensor) => sensor.id === id);
    if (current && current.type !== 'discovered') continue;
    const fields: SensorFieldMap = {
      ...(msg.fields[`A${id}`] !== undefined ? { temperature: `A${id}` } : {}),
      ...(msg.fields[`H${id}`] !== undefined ? { secondary: `H${id}` } : {}),
      ...(msg.fields[`B${id}`] !== undefined ? { battery: `B${id}` } : {}),
      ...(msg.fields[`K${id}`] !== undefined ? { status: `K${id}` } : {}),
    };
    const next: SensorDefinition = current
      ? { ...current, fields: { ...current.fields, ...fields } }
      : { id, name: `Sensor ${id}`, type: 'discovered', fields };
    if (!current || JSON.stringify(current.fields) !== JSON.stringify(next.fields)) changed.push(next);
  }
  return changed;
}

// Maps generic raw fields -> normalized sensors using config only.
export function normalizeMessage(msg: G7ParsedMessage, defs: SensorDefinition[], now = new Date().toISOString()): NormalizedState {
  const sensors: Record<string, NormalizedSensor> = {};
  for (const def of defs) {
    const t = def.fields.temperature ? num(msg.fields[def.fields.temperature]) : undefined;
    const t2 = def.fields.temperature2 ? num(msg.fields[def.fields.temperature2]) : undefined;
    const h = def.fields.humidity ? num(msg.fields[def.fields.humidity]) : undefined;
    const secondary = def.fields.secondary ? num(msg.fields[def.fields.secondary]) : undefined;
    const b = def.fields.battery ? num(msg.fields[def.fields.battery]) : undefined;
    const rawStatus = def.fields.status ? msg.fields[def.fields.status] : undefined;
    const seen = t !== undefined || t2 !== undefined || h !== undefined || secondary !== undefined || b !== undefined || rawStatus !== undefined;
    if (!seen) continue; // sensor absent from this frame
    if (def.active === false) continue;
    sensors[def.id] = { lastSeen: now, ...(t !== undefined ? { temperature: t } : {}), ...(t2 !== undefined ? { temperature2: t2 } : {}), ...(h !== undefined ? { humidity: h } : {}), ...(secondary !== undefined ? { secondary } : {}), ...(b !== undefined ? { battery: b } : {}), ...(rawStatus !== undefined ? { rawStatus } : {}) };
  }
  return { stationId: msg.stationId, sensors, lastMessageAt: now, rawMessage: msg.rawMessage };
}
