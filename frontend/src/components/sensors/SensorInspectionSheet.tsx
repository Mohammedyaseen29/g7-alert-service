import { useMemo } from 'react';
import { Activity, ArrowLeft, BatteryMedium, Download, Droplets, Gauge, Settings2, Thermometer, Wifi, type LucideIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Line, LineChart, PolarAngleAxis, RadialBar, RadialBarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge } from '../ui/badge.js';
import { Button } from '../ui/button.js';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../ui/sheet.js';
import type { AlarmConfig, Sensor } from '../../types.js';
import { useAuth } from '../../auth.js';
import {
  downloadSensorReadings,
  sensorHealth,
  sensorReadingsForExport,
  temperatureScale,
  temperatureTrend,
  type TelemetrySample,
} from '../../lib/telemetry.js';

interface SensorInspectionSheetProps {
  sensor: Sensor | null;
  history: TelemetrySample[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  stale?: boolean;
  returnFocusRef?: { current: HTMLButtonElement | null };
}

function number(value: number | undefined, digits = 2): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function absoluteTime(iso?: string): string {
  if (!iso) return 'No data received';
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'Timestamp unavailable';
}

function healthLabel(sensor: Sensor): string {
  const health = sensorHealth(sensor);
  if (health === 'critical') return `${sensor.activeAlarmCount ?? 0} active alarm${sensor.activeAlarmCount === 1 ? '' : 's'}`;
  if (health === 'warning') return sensor.online === false ? 'Offline' : 'Threshold exceeded';
  return 'Normal';
}

function healthClass(sensor: Sensor): string {
  const health = sensorHealth(sensor);
  return health === 'critical'
    ? 'border-rose-200 bg-rose-50 text-rose-700'
    : health === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-700'
      : 'border-teal-200 bg-teal-50 text-teal-700';
}

function ThresholdRow({
  label,
  icon: Icon,
  config,
  unit,
  single = false,
}: {
  label: string;
  icon: LucideIcon;
  config: { high?: number; low?: number; enabled?: boolean } | undefined;
  unit: string;
  single?: boolean;
}) {
  const state = config?.enabled === false ? 'Disabled' : config?.enabled === true ? 'Enabled' : 'Not configured';
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${config?.enabled === false ? 'border-slate-200 bg-slate-100/80 text-slate-500' : 'border-slate-200 bg-white text-slate-700'}`}>
      <div className="flex items-center gap-2">
        <Icon aria-hidden="true" className="size-4 text-teal-600" />
        <span className="font-medium">{label}</span>
        <span className={`ml-auto text-[10px] font-semibold uppercase tracking-[0.12em] ${config?.enabled === false ? 'text-slate-400' : config?.enabled === true ? 'text-teal-700' : 'text-slate-400'}`}>
          {state}
        </span>
      </div>
      <div className="mt-2 flex gap-5 border-t border-slate-100 pt-2 font-mono text-xs text-slate-600">
        {single ? <span>Alert below <b className="text-slate-900">{number(config?.low)}{unit}</b></span> : <><span>Low <b className="text-slate-900">{number(config?.low)}{unit}</b></span><span>High <b className="text-slate-900">{number(config?.high)}{unit}</b></span></>}
      </div>
    </div>
  );
}

function TemperatureGauge({ sensor, stale }: { sensor: Sensor; stale: boolean }) {
  const current = sensor.reading?.temperature;
  const scale = temperatureScale(sensor);
  if (current === undefined) {
    return <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center text-sm text-slate-500">Temperature is not present in the latest real reading.</div>;
  }
  if (!scale) {
    return <div className="flex min-h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center text-sm text-slate-500">Temperature alarm scale is disabled or incomplete. The chart waits for real low and high thresholds.</div>;
  }

  const chartValue = Math.min(scale.high, Math.max(scale.low, current));
  const critical = sensorHealth(sensor) === 'critical';
  return (
    <div className={`rounded-xl border p-3 ${critical ? 'border-rose-200 bg-rose-50/45' : 'border-slate-200 bg-slate-50/80'}`}>
      <div className="flex items-center justify-between px-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
        <span>Temperature</span>
        <span className="font-mono normal-case tracking-normal text-slate-500">{number(scale.low)}°–{number(scale.high)}°C</span>
      </div>
      <div className="relative mx-auto h-44 max-w-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <RadialBarChart
            data={[{ value: chartValue }]}
            cx="50%"
            cy="58%"
            innerRadius="68%"
            outerRadius="92%"
            startAngle={220}
            endAngle={-40}
            barSize={14}
          >
            <PolarAngleAxis type="number" domain={[scale.low, scale.high]} tick={false} />
            <RadialBar dataKey="value" cornerRadius={10} background={{ fill: critical ? '#fecdd3' : '#dbe5e7' }} fill={critical ? '#e11d48' : '#0f766e'} isAnimationActive />
          </RadialBarChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-5">
          <span className="font-mono text-3xl font-semibold tracking-tight text-slate-950">{number(current)}°</span>
          <span className={`text-[10px] font-semibold uppercase tracking-[0.15em] ${critical ? 'text-rose-600' : 'text-slate-400'}`}>{stale ? 'last known' : sensor.online === false ? 'last reading' : sensor.online === true ? 'current reading' : 'observed reading'}</span>
        </div>
      </div>
      {current < scale.low || current > scale.high ? <p className="m-0 text-center text-xs text-amber-700">Reading is outside the configured scale; gauge edge is clamped for legibility.</p> : null}
    </div>
  );
}

function ChannelValue({ label, value, unit, icon: Icon }: { label: string; value: number | undefined; unit: string; icon: LucideIcon }) {
  if (value === undefined) return null;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <Icon aria-hidden="true" className="size-4 text-teal-600" />
      <span className="text-sm text-slate-600">{label}</span>
      <span className="ml-auto font-mono font-semibold text-slate-950">{number(value)}{unit}</span>
    </div>
  );
}

function TrendChart({ history }: { history: TelemetrySample[] }) {
  const data = useMemo(() => temperatureTrend(history), [history]);
  if (data.length < 2) {
    return <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">Collecting trend · {history.length < 2 ? `need ${2 - history.length} more real sample${history.length === 0 ? 's' : ''}` : 'temperature is not present in both samples'}.</div>;
  }

  return (
    <div className="h-44 rounded-lg border border-slate-200 bg-slate-50/80 p-2" aria-label={`${data.length} real temperature samples`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
          <XAxis dataKey="timestamp" tickFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} />
          <YAxis domain={['auto', 'auto']} tick={{ fontSize: 10, fill: '#64748b' }} axisLine={false} tickLine={false} width={45} tickFormatter={(value) => `${value}°`} />
          <Tooltip labelFormatter={(value) => absoluteTime(String(value))} formatter={(value) => [`${number(Number(value))}°C`, 'Temperature']} />
          <Line type="monotone" dataKey="temperature" stroke="#0f766e" strokeWidth={2.5} dot={{ r: 2, fill: '#0f766e' }} activeDot={{ r: 4 }} isAnimationActive />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SensorInspectionSheet({ sensor, history, open, onOpenChange, stale = false, returnFocusRef }: SensorInspectionSheetProps) {
  const { role } = useAuth();
  const canConfigure = role === 'ADMIN' || role === 'OPERATOR';
  const exportable = sensor ? sensorReadingsForExport(sensor, history) : [];
  const reading = sensor?.reading;
  const fields = sensor?.fields ?? {};
  const thresholds: AlarmConfig = sensor?.thresholds ?? {};

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto border-slate-200 bg-[#f8faf9] p-0 sm:max-w-xl" onCloseAutoFocus={(event) => { if (returnFocusRef?.current) { event.preventDefault(); returnFocusRef.current.focus(); } }}>
        {sensor ? (
          <div className="min-h-full">
            <SheetHeader className="border-b border-slate-200 bg-[#0b1f2a] px-6 py-6 pr-14 text-white">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <SheetTitle className="text-white">{sensor.name || `Sensor ${sensor.id}`}</SheetTitle>
                  <SheetDescription className="mt-1 font-mono text-xs text-slate-300">Sensor ID · {sensor.id}</SheetDescription>
                </div>
                <Badge variant="outline" className={`rounded-full bg-white/5 ${healthClass(sensor)}`}>{healthLabel(sensor)}</Badge>
              </div>
              <p className="m-0 flex items-center gap-2 text-xs text-slate-300"><Wifi aria-hidden="true" className="size-3.5" />Last seen {absoluteTime(reading?.lastSeen)}</p>
            </SheetHeader>

            {stale ? <div role="status" className="border-b border-amber-200 bg-amber-50 px-6 py-3 text-xs font-medium text-amber-900">Updates unavailable — showing the last known reading.</div> : null}

            <div className="space-y-5 p-6">
              <section aria-labelledby="temperature-heading">
                <div className="mb-2 flex items-center gap-2">
                  <Gauge aria-hidden="true" className="size-4 text-teal-700" />
                  <h2 id="temperature-heading" className="m-0 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Temperature inspection</h2>
                </div>
                <TemperatureGauge sensor={sensor} stale={stale} />
              </section>

              <section aria-labelledby="channels-heading">
                <h2 id="channels-heading" className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Observed channels</h2>
                {reading ? (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <ChannelValue label="Temperature" value={reading.temperature} unit="°C" icon={Thermometer} />
                    <ChannelValue label="Temperature 2" value={reading.temperature2} unit="°C" icon={Thermometer} />
                    <ChannelValue label="Humidity" value={reading.humidity} unit="%" icon={Droplets} />
                    <ChannelValue label="Secondary channel" value={reading.secondary} unit="" icon={Activity} />
                    <ChannelValue label="Battery" value={reading.battery} unit="V" icon={BatteryMedium} />
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">No real reading has been received for this sensor.</div>
                )}
                <p className="mt-2 text-xs text-slate-500">
                  {fields.humidity ? `Humidity channel ${fields.humidity}` : fields.temperature2 ? `Secondary temperature channel ${fields.temperature2}` : fields.secondary ? `Unclassified secondary channel ${fields.secondary}` : 'Only channels reported by the sensor are shown.'}
                </p>
              </section>

              <section aria-labelledby="trend-heading">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 id="trend-heading" className="m-0 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Session trend</h2>
                  <span className="font-mono text-xs text-slate-400">{history.length}/60 samples</span>
                </div>
                <TrendChart history={history} />
              </section>

              <section aria-labelledby="thresholds-heading">
                <h2 id="thresholds-heading" className="mb-2 text-sm font-semibold uppercase tracking-[0.14em] text-slate-500">Alarm thresholds</h2>
                <div className="space-y-2">
                  <ThresholdRow label="Temperature" icon={Thermometer} config={thresholds.temperature} unit="°C" />
                  {fields.humidity || reading?.humidity !== undefined ? <ThresholdRow label="Humidity" icon={Droplets} config={thresholds.humidity} unit="%" /> : null}
                  {fields.battery || reading?.battery !== undefined ? <ThresholdRow label="Battery" icon={BatteryMedium} config={thresholds.battery} unit="V" single /> : null}
                </div>
              </section>

              <p className="m-0 text-xs leading-relaxed text-slate-500">Health classification: Critical means an active alarm is reported. Warning means the sensor is offline or a configured threshold is exceeded. Normal means neither condition is currently reported.</p>
            </div>
            <div className="sticky bottom-0 z-10 flex flex-col gap-2 border-t border-slate-200 bg-[#f8faf9]/95 p-4 shadow-[0_-8px_20px_rgba(11,31,42,0.06)] backdrop-blur sm:flex-row">
              <SheetClose asChild>
                <Button type="button" variant="outline" className="gap-2 border-slate-300 bg-white">
                  <ArrowLeft aria-hidden="true" className="size-4" />
                  Back to sensors
                </Button>
              </SheetClose>
              <Button type="button" variant="outline" className="gap-2 border-slate-300 bg-white" disabled={exportable.length === 0} onClick={() => { if (sensor) downloadSensorReadings(sensor, history); }}>
                <Download aria-hidden="true" className="size-4" />
                Export CSV{exportable.length > 0 ? ` · ${exportable.length}` : ''}
              </Button>
              {canConfigure ? (
                <Button type="button" className="gap-2 bg-[#0f766e] text-white hover:bg-[#115e59]" asChild>
                  <Link to={`/sensors/${sensor.id}/config`} onClick={() => onOpenChange(false)}><Settings2 aria-hidden="true" className="size-4" />Configure Node</Link>
                </Button>
              ) : (
                <Button type="button" disabled className="gap-2" title="Operator role required"><Settings2 aria-hidden="true" className="size-4" />Configure Node</Button>
              )}
            </div>
          </div>
        ) : (
          <div className="p-6"><SheetHeader><SheetTitle>Sensor inspection</SheetTitle><SheetDescription>Select a sensor to inspect its live readings.</SheetDescription></SheetHeader></div>
        )}
      </SheetContent>
    </Sheet>
  );
}
