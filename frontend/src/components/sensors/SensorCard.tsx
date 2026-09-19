import { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryMedium,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Droplets,
  Radio,
  Thermometer,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';
import { Line, LineChart, ResponsiveContainer } from 'recharts';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card.js';
import type { Sensor } from '../../types.js';
import { sensorHealth, temperatureTrend, thresholdBreaches, type SensorHistory } from '../../lib/telemetry.js';

interface SensorCardProps {
  sensor: Sensor;
  history: SensorHistory[string];
  onInspect: (sensor: Sensor, trigger: HTMLButtonElement) => void;
}

function number(value: number | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function relativeTime(iso?: string): string {
  if (!iso) return 'No data received';
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return 'Timestamp unavailable';
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function healthReason(sensor: Sensor): string {
  const health = sensorHealth(sensor);
  if (health === 'critical') return `${sensor.activeAlarmCount ?? 0} active alarm${sensor.activeAlarmCount === 1 ? '' : 's'}`;
  if (sensor.online === false || (sensor.online === undefined && !sensor.reading)) return 'No recent data reported';
  if (thresholdBreaches(sensor).length > 0) return 'Threshold exceeded';
  return 'Reporting within configured status';
}

function prominentChannel(reading: NonNullable<Sensor['reading']>): { label: string; value: number; unit: string } | null {
  if (reading.temperature2 !== undefined) return { label: 'Temperature 2', value: reading.temperature2, unit: '°C' };
  if (reading.humidity !== undefined) return { label: 'Humidity', value: reading.humidity, unit: '%' };
  if (reading.secondary !== undefined) return { label: 'Secondary channel', value: reading.secondary, unit: '' };
  return null;
}

export function SensorCard({ sensor, history, onInspect }: SensorCardProps) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const health = sensorHealth(sensor);
  const trend = temperatureTrend(history);
  const reading = sensor.reading;
  const secondary = reading ? prominentChannel(reading) : null;
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    update();
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);
  const statusIcon = health === 'critical' ? AlertTriangle : health === 'warning' ? WifiOff : CheckCircle2;
  const StatusIcon = statusIcon;
  const statusClass = health === 'critical'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : health === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-teal-200 bg-teal-50 text-teal-700';

  return (
    <Card className="group relative overflow-hidden border-slate-200/80 bg-white/95 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-teal-300 hover:shadow-lg hover:shadow-slate-900/5">
      <div className={`absolute inset-x-0 top-0 h-1 ${health === 'critical' ? 'bg-rose-500' : health === 'warning' ? 'bg-amber-400' : 'bg-teal-500'}`} />
      <CardHeader className="pb-3 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardDescription className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
              Sensor ID · {sensor.id}
            </CardDescription>
            <CardTitle className="mt-1 truncate text-lg text-slate-950">{sensor.name || `Sensor ${sensor.id}`}</CardTitle>
          </div>
          <Badge variant="outline" className={`shrink-0 gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusClass}`}>
            <StatusIcon aria-hidden="true" className="size-3.5" />
            {health === 'critical' ? 'Critical' : health === 'warning' ? 'Warning' : 'Normal'}
          </Badge>
        </div>
        <p className="m-0 text-xs text-slate-500">{healthReason(sensor)}</p>
      </CardHeader>

      <CardContent className="space-y-4">
        {reading ? (
          <>
            <div className={`grid gap-3 ${secondary && reading.temperature !== undefined ? 'grid-cols-2' : 'grid-cols-1'}`}>
              {reading.temperature !== undefined ? <div className="min-w-0 rounded-xl border border-teal-100 bg-gradient-to-br from-teal-50/80 to-white px-4 py-3"><p className="m-0 truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-teal-700/75">Temperature</p><p className="m-0 mt-1 whitespace-nowrap font-mono text-3xl font-semibold tracking-tight text-[#0b1f2a] sm:text-4xl">{number(reading.temperature)}<span className="ml-1 text-lg font-medium text-slate-500">°C</span></p></div> : null}
              {secondary ? <div className="min-w-0 rounded-xl border border-sky-100 bg-gradient-to-br from-sky-50/80 to-white px-4 py-3"><p className="m-0 truncate text-[11px] font-semibold uppercase tracking-[0.16em] text-sky-700/75">{secondary.label}</p><p className="m-0 mt-1 whitespace-nowrap font-mono text-3xl font-semibold tracking-tight text-[#0b1f2a] sm:text-4xl">{number(secondary.value)}<span className="ml-1 text-lg font-medium text-slate-500">{secondary.unit}</span></p></div> : null}
            </div>
          </>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50/80 px-3 py-3 text-sm text-slate-500">
            <Radio aria-hidden="true" className="size-4 text-slate-400" />
            No live reading received yet
          </div>
        )}

        <div className="rounded-lg border border-slate-100 bg-slate-50/65 px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
            <span className="flex items-center gap-1.5"><Activity aria-hidden="true" className="size-3.5" />Temperature trend</span>
            <span className="font-mono normal-case tracking-normal text-slate-400">{history.length}/60 samples</span>
          </div>
          {trend.length >= 2 ? (
            <div className="h-12 w-full" aria-label={`${trend.length} real temperature samples`}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend} margin={{ top: 4, right: 2, bottom: 2, left: 2 }}>
                  <Line type="monotone" dataKey="temperature" stroke="#0f766e" strokeWidth={2} dot={false} isAnimationActive={!reduceMotion} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="m-0 text-xs text-slate-500">
              {history.length === 0 ? 'Collecting trend · waiting for the first real sample' : 'Collecting trend · need one more real sample'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
          <span className="text-slate-500">Battery</span>
          <span className="font-mono font-semibold text-slate-900">{reading?.battery !== undefined ? `${number(reading.battery, 3)}V` : 'Not reported'}</span>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <span className="flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500">
            <Clock3 aria-hidden="true" className="size-3.5 shrink-0" />
            Last seen {relativeTime(reading?.lastSeen)}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5 border-slate-200 text-slate-700 transition-colors group-hover:border-teal-300 group-hover:text-teal-700"
            onClick={(event) => onInspect(sensor, event.currentTarget)}
            aria-label={`Inspect sensor ${sensor.id}`}
          >
            Inspect <ChevronRight aria-hidden="true" className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
