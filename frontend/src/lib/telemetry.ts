import type { Sensor, SensorReading } from '../types.js';

export const MAX_TELEMETRY_SAMPLES = 60;

/** A reading captured by this browser from a real API response. */
export interface TelemetrySample extends SensorReading {
  sensorId: string;
}

export type SensorHistory = Record<string, TelemetrySample[]>;

export type SensorHealth = 'normal' | 'warning' | 'critical';

export interface ThresholdBreach {
  channel: 'temperature' | 'temperature2' | 'humidity' | 'battery';
  direction: 'high' | 'low';
  value: number;
  threshold: number;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function readingSample(sensor: Sensor): TelemetrySample | null {
  const reading = sensor.reading;
  if (!reading?.lastSeen || !Number.isFinite(Date.parse(reading.lastSeen))) return null;

  return {
    sensorId: sensor.id,
    lastSeen: reading.lastSeen,
    ...(finite(reading.temperature) ? { temperature: reading.temperature } : {}),
    ...(finite(reading.temperature2) ? { temperature2: reading.temperature2 } : {}),
    ...(finite(reading.humidity) ? { humidity: reading.humidity } : {}),
    ...(finite(reading.secondary) ? { secondary: reading.secondary } : {}),
    ...(finite(reading.battery) ? { battery: reading.battery } : {}),
    ...(typeof reading.rawStatus === 'string' ? { rawStatus: reading.rawStatus } : {}),
  };
}

/**
 * Add each observed lastSeen timestamp at most once and retain the newest 60.
 * The history is intentionally in-memory only; it is not a substitute for the
 * backend history API.
 */
export function recordSensorSamples(history: SensorHistory, sensors: Sensor[]): boolean {
  let changed = false;

  for (const sensor of sensors) {
    const sample = readingSample(sensor);
    if (!sample) continue;

    const existing = history[sensor.id] ?? [];
    if (existing.some((item) => item.lastSeen === sample.lastSeen)) continue;

    history[sensor.id] = [...existing, sample]
      .sort((left, right) => Date.parse(left.lastSeen) - Date.parse(right.lastSeen))
      .slice(-MAX_TELEMETRY_SAMPLES);
    changed = true;
  }

  return changed;
}

export function temperatureTrend(samples: TelemetrySample[]) {
  return samples
    .filter((sample): sample is TelemetrySample & { temperature: number } => finite(sample.temperature))
    .sort((left, right) => Date.parse(left.lastSeen) - Date.parse(right.lastSeen))
    .map((sample) => ({
      timestamp: sample.lastSeen,
      temperature: sample.temperature,
    }));
}

export function thresholdBreaches(sensor: Sensor): ThresholdBreach[] {
  const reading = sensor.reading;
  const thresholds = sensor.thresholds;
  if (!reading || !thresholds) return [];

  const breaches: ThresholdBreach[] = [];
  const checkRange = (
    channel: ThresholdBreach['channel'],
    value: number | undefined,
    range: { high?: number; low?: number; enabled?: boolean } | undefined,
  ) => {
    if (!finite(value) || range?.enabled !== true) return;
    if (finite(range.high) && value > range.high) breaches.push({ channel, direction: 'high', value, threshold: range.high });
    if (finite(range.low) && value < range.low) breaches.push({ channel, direction: 'low', value, threshold: range.low });
  };

  checkRange('temperature', reading.temperature, thresholds.temperature);
  checkRange('temperature2', reading.temperature2, thresholds.temperature);
  checkRange('humidity', reading.humidity, thresholds.humidity);

  if (finite(reading.battery) && thresholds.battery?.enabled === true && finite(thresholds.battery.low) && reading.battery < thresholds.battery.low) {
    breaches.push({ channel: 'battery', direction: 'low', value: reading.battery, threshold: thresholds.battery.low });
  }

  return breaches;
}

export function sensorHealth(sensor: Sensor): SensorHealth {
  if ((sensor.activeAlarmCount ?? 0) > 0) return 'critical';
  const offline = sensor.online === false || (sensor.online === undefined && !sensor.reading);
  if (offline || thresholdBreaches(sensor).length > 0) return 'warning';
  return 'normal';
}

export function temperatureScale(sensor: Sensor): { low: number; high: number } | null {
  const range = sensor.thresholds?.temperature;
  if (range?.enabled !== true || !finite(range.low) || !finite(range.high) || range.high <= range.low) return null;
  return { low: range.low, high: range.high };
}

export function sensorReadingsForExport(sensor: Sensor, samples: TelemetrySample[]): TelemetrySample[] {
  const observed = [...samples];
  // A freshly loaded reading can be exported before the history effect paints.
  // It is still real data, so include it once when it is not already present.
  const current = readingSample(sensor);
  if (current && !observed.some((sample) => sample.lastSeen === current.lastSeen)) observed.push(current);
  return observed;
}

function csvCell(value: unknown): string {
  const isString = typeof value === 'string';
  const text = value === undefined || value === null ? '' : String(value);
  // Keep negative numeric readings numeric, but neutralize spreadsheet formula
  // prefixes on string fields such as a raw status value.
  const safeText = isString && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
}

export function downloadSensorReadings(sensor: Sensor, samples: TelemetrySample[]): boolean {
  const observed = sensorReadingsForExport(sensor, samples);
  if (observed.length === 0) return false;

  const header = ['sensor_id', 'last_seen', 'temperature_c', 'temperature_2_c', 'humidity_percent', 'secondary', 'battery_v', 'raw_status'];
  const rows = observed.map((sample) => [
    sensor.id,
    sample.lastSeen,
    sample.temperature,
    sample.temperature2,
    sample.humidity,
    sample.secondary,
    sample.battery,
    sample.rawStatus,
  ].map(csvCell).join(','));
  const blob = new Blob([[header.join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const safeId = sensor.id.replace(/[^a-z0-9_-]+/gi, '-');
  anchor.href = url;
  anchor.download = `sensor-${safeId || 'readings'}-readings.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
  return true;
}
