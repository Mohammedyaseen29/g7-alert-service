export interface SensorReading {
  temperature?: number;
  temperature2?: number;
  humidity?: number;
  secondary?: number;
  battery?: number;
  rawStatus?: string;
  lastSeen: string;
}
export interface Sensor {
  id: string;
  name: string;
  type: string;
  active?: boolean;
  fields: Record<string, string>;
  reading: SensorReading | null;
  thresholds?: AlarmConfig;
  online?: boolean;
  activeAlarmCount?: number;
}
export interface AlarmConfig {
  temperature?: { high?: number; low?: number; enabled?: boolean };
  humidity?: { high?: number; low?: number; enabled?: boolean };
  battery?: { low?: number; enabled?: boolean };
  comm?: { enabled?: boolean };
  delaySeconds?: number;
  repeatMinutes?: number;
}

export interface NotificationConfig {
  emails: string[];
  updatedAt?: string;
}

export function validateConfig(c: AlarmConfig): string[] {
  const errs: string[] = [];
  if (c.temperature?.high !== undefined && c.temperature?.low !== undefined && c.temperature.high <= c.temperature.low)
    errs.push('Temperature high must be greater than low.');
  if (c.humidity?.high !== undefined && c.humidity?.low !== undefined && c.humidity.high <= c.humidity.low)
    errs.push('Humidity high must be greater than low.');
  if (c.battery?.low !== undefined && (c.battery.low < 2 || c.battery.low > 5))
    errs.push('Battery low threshold looks out of range (2-5V).');
  return errs;
}
