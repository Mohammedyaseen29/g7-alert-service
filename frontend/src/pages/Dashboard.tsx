import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock3, Radio, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent } from '../components/ui/card.js';
import { SensorCard } from '../components/sensors/SensorCard.js';
import { SensorInspectionSheet } from '../components/sensors/SensorInspectionSheet.js';
import { api } from '../api.js';
import type { Sensor } from '../types.js';
import { useLiveSensors } from '../hooks.js';
import { recordSensorSamples, sensorHealth, type SensorHistory } from '../lib/telemetry.js';

type Filter = 'all' | 'normal' | 'warning' | 'critical';
type StatusFilter = 'all' | 'active' | 'inactive';

interface SystemStatus {
  g7?: string;
  lastMessage?: string | null;
  lastSensorUpdate?: string | null;
  activeSensors?: number;
  activeAlarms?: number;
  connectedBaseStations?: number;
  tcpListening?: boolean;
  notificationRecipients?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'Telemetry could not be refreshed.';
}

function dataTime(iso?: string | null): string {
  if (!iso) return 'No telemetry received yet';
  const timestamp = Date.parse(iso);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : 'Timestamp unavailable';
}

function dataAge(iso: string | null | undefined, now: number): string {
  if (!iso) return 'No telemetry received yet';
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return 'Timestamp unavailable';
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function baseStationClass(state?: string): string {
  if (state === 'LIVE') return 'border-teal-200 bg-teal-50 text-teal-700';
  if (state === 'CONNECTED') return 'border-amber-200 bg-amber-50 text-amber-700';
  if (state === 'DISCONNECTED') return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function baseStationIcon(state?: string) {
  if (state === 'LIVE') return CheckCircle2;
  if (state === 'DISCONNECTED') return WifiOff;
  return Radio;
}

function countText(value: number | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
}

function filterClass(filter: Filter, active: boolean): string {
  if (!active) return 'border-slate-200 bg-white text-slate-600';
  if (filter === 'critical') return 'border-rose-600 bg-rose-600 text-white hover:bg-rose-700';
  if (filter === 'warning') return 'border-amber-500 bg-amber-500 text-white hover:bg-amber-600';
  if (filter === 'normal') return 'border-teal-700 bg-teal-700 text-white hover:bg-teal-800';
  return 'border-[#0b1f2a] bg-[#0b1f2a] text-white hover:bg-[#163848]';
}

function statusFilterClass(active: boolean): string {
  return active
    ? 'border-[#0b1f2a] bg-[#0b1f2a] text-white hover:bg-[#163848]'
    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900';
}
export function Dashboard() {
  const [sensors, setSensors] = useState<Sensor[] | null>(null);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedSensorId, setSelectedSensorId] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const inspectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const statusFilterRef = useRef<HTMLButtonElement | null>(null);
  const historyRef = useRef<SensorHistory>({});
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const [nextSensors, nextStatus] = await Promise.all([api.sensors(), api.status()]);
      if (request !== requestRef.current) return;
      setSensors(nextSensors);
      setStatus(nextStatus as SystemStatus);
      setError(null);
    } catch (cause) {
      if (request === requestRef.current) setError(errorMessage(cause));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => { void load(); }, 10_000);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    const ticker = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(ticker);
  }, []);

  const live = useLiveSensors(load);

  const toggleSensorStatus = useCallback(async (sensorId: string) => {
    const sensor = sensors?.find((item) => item.id === sensorId);
    if (!sensor) return;
    await api.setSensorStatus(sensorId, !sensor.active);
    await load();
  }, [load, sensors]);

  useEffect(() => {
    if (!sensors) return;
    if (recordSensorSamples(historyRef.current, sensors)) setHistoryVersion((version) => version + 1);
  }, [sensors]);

  const counts = useMemo(() => {
    const values = { all: sensors?.length ?? 0, normal: 0, warning: 0, critical: 0 };
    for (const sensor of sensors ?? []) values[sensorHealth(sensor)] += 1;
    return values;
  }, [sensors]);

  const visibleSensors = useMemo(() => (
    (sensors ?? []).filter((sensor) => (
      (filter === 'all' || sensorHealth(sensor) === filter)
      && (statusFilter === 'all' || (statusFilter === 'active') === (sensor.active !== false))
    ))
  ), [filter, sensors, statusFilter]);

  const inactiveCount = useMemo(() => (
    (sensors ?? []).filter((sensor) => sensor.active === false).length
  ), [sensors]);

  const selectedSensor = useMemo(
    () => (selectedSensorId ? sensors?.find((sensor) => sensor.id === selectedSensorId) ?? null : null),
    [selectedSensorId, sensors],
  );

  // Reading this ref makes the relationship explicit for the render and keeps
  // history browser-local; the version forces a redraw after a new sample.
  void historyVersion;
  const baseState = error ? undefined : status?.g7;
  const BaseIcon = baseStationIcon(baseState);
  const lastData = error ? null : status?.lastSensorUpdate ?? status?.lastMessage;

  return (
    <main className="w-full max-w-none min-h-[calc(100vh-64px)] bg-[#f8faf9] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <section className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <p className="m-0 font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-700">Pride Monitor · operations</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#0b1f2a] sm:text-4xl">Temperature &amp; Humidity</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-500">Live sensor temperatures, humidity, and device status at a glance.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <Badge variant="outline" className={`gap-1.5 rounded-full px-3 py-1.5 font-semibold ${baseStationClass(baseState)}`}>
              <BaseIcon aria-hidden="true" className="size-3.5" />
              Base station · {baseState ?? (error ? 'UNAVAILABLE' : 'CHECKING')}
            </Badge>
            <Badge variant="outline" className="gap-1.5 rounded-full border-slate-200 bg-white px-3 py-1.5 font-medium text-slate-600">
              <Wifi aria-hidden="true" className="size-3.5 text-teal-700" />
              {live ? 'WebSocket live' : '10s polling'}
            </Badge>
          </div>
        </section>

        <section className="grid gap-3 sm:grid-cols-3" aria-label="Telemetry summary">
          <Card className="border-slate-200/80 bg-white/90 shadow-sm"><CardContent className="p-4"><p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Nodes discovered</p><p className="mt-1 font-mono text-2xl font-semibold text-[#0b1f2a]">{sensors ? countText(counts.all) : '—'}</p><p className="m-0 text-xs text-slate-500">{sensors ? `${countText(status?.activeSensors)} reporting online` : 'Waiting for telemetry'}</p></CardContent></Card>
          <Card className="border-slate-200/80 bg-white/90 shadow-sm"><CardContent className="p-4"><p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Last data</p><p className="mt-1 flex items-center gap-2 text-sm font-semibold text-[#0b1f2a]" title={dataTime(lastData)}><Clock3 aria-hidden="true" className="size-4 text-teal-700" />{dataAge(lastData, now)}</p><p className="m-0 text-xs text-slate-500">Base station update ticker</p></CardContent></Card>
          <Card className="border-slate-200/80 bg-white/90 shadow-sm"><CardContent className="p-4"><p className="m-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Active alarms</p><p className="mt-1 font-mono text-2xl font-semibold text-[#0b1f2a]">{status && !error ? countText(status.activeAlarms) : '—'}</p><p className="m-0 text-xs text-slate-500">Current reported count</p></CardContent></Card>
        </section>

        {error && sensors ? (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
            <span className="flex items-center gap-2"><AlertCircle aria-hidden="true" className="size-4 shrink-0" />Latest refresh failed: {error}. Showing the last successful response.</span>
            <Button type="button" variant="outline" size="sm" className="gap-1.5 border-amber-300 bg-transparent text-amber-900" onClick={() => { void load(); }}><RefreshCw aria-hidden="true" className="size-3.5" />Retry</Button>
          </div>
        ) : null}

        <section aria-labelledby="sensor-list-heading" className="flex flex-col gap-4 border-b border-slate-200 pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 id="sensor-list-heading" className="m-0 text-xl font-semibold tracking-tight text-[#0b1f2a]">Sensors</h2>
            <p className="mt-1 text-sm text-slate-500">{sensors ? `${visibleSensors.length} of ${counts.all} sensors shown` : 'Loading sensor list'}</p>
          </div>
          <div className="flex flex-col gap-2 lg:items-end">
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Sensor status filters">
              <span className="mr-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Status</span>
              {([
                ['all', 'All', counts.all],
                ['active', 'Active', counts.all - inactiveCount],
                ['inactive', 'Inactive', inactiveCount],
              ] as const).map(([value, label, count]) => (
                <Button key={value} ref={statusFilter === value ? statusFilterRef : undefined} type="button" aria-pressed={statusFilter === value} variant="outline" size="sm" className={statusFilterClass(statusFilter === value)} onClick={() => setStatusFilter(value)}>
                  {label}<span className="ml-1 font-mono text-[10px] opacity-75">{sensors ? count : '—'}</span>
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Device health filters">
              <span className="mr-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Health</span>
              {([
                ['all', 'All'],
                ['normal', 'Normal'],
                ['warning', 'Warning'],
                ['critical', 'Critical'],
              ] as const).map(([value, label]) => (
                <Button key={value} type="button" aria-pressed={filter === value} variant="outline" size="sm" className={filterClass(value, filter === value)} onClick={() => setFilter(value)}>
                  {label}<span className="ml-1 font-mono text-[10px] opacity-75">{sensors ? counts[value] : '—'}</span>
                </Button>
              ))}
            </div>
          </div>
        </section>

        {loading && !sensors ? (
          <Card className="border-slate-200 bg-white shadow-sm"><CardContent className="flex items-center gap-3 p-8 text-sm text-slate-500" aria-live="polite"><RefreshCw aria-hidden="true" className="size-4 animate-spin text-teal-700" />Loading live telemetry…</CardContent></Card>
        ) : error && !sensors ? (
          <Card className="border-rose-200 bg-rose-50/60 shadow-sm"><CardContent className="flex flex-col items-start gap-4 p-8" role="alert"><div className="flex items-center gap-2 text-sm font-semibold text-rose-800"><AlertCircle aria-hidden="true" className="size-4" />Telemetry unavailable</div><p className="m-0 text-sm text-rose-700">{error}</p><Button type="button" variant="outline" className="gap-2 border-rose-300 bg-transparent text-rose-800" onClick={() => { void load(); }}><RefreshCw aria-hidden="true" className="size-4" />Retry</Button></CardContent></Card>
        ) : sensors?.length === 0 ? (
          <Card className="border-slate-200 bg-white shadow-sm"><CardContent className="flex flex-col items-center gap-3 p-10 text-center"><Radio aria-hidden="true" className="size-8 text-slate-300" /><h2 className="m-0 text-lg font-semibold text-slate-800">No sensors discovered yet</h2><p className="m-0 max-w-lg text-sm leading-relaxed text-slate-500">No valid sensor frame has been observed. Nodes will appear here after the base station sends real telemetry.</p></CardContent></Card>
        ) : visibleSensors.length === 0 ? (
          <Card className="border-slate-200 bg-white shadow-sm"><CardContent className="flex flex-col items-center gap-3 p-10 text-center"><WifiOff aria-hidden="true" className="size-8 text-slate-300" /><h2 className="m-0 text-lg font-semibold text-slate-800">No sensors match these filters</h2><p className="m-0 text-sm text-slate-500">Try another status or health filter to find your sensor.</p><Button type="button" variant="outline" onClick={() => { setStatusFilter('all'); setFilter('all'); }}>Show all sensors</Button></CardContent></Card>
        ) : (
          <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Sensor grid">
            {visibleSensors.map((sensor) => <SensorCard key={sensor.id} sensor={sensor} active={sensor.active !== false} history={historyRef.current[sensor.id] ?? []} onInspect={(item, trigger) => { inspectTriggerRef.current = trigger; setSelectedSensorId(item.id); }} />)}
          </section>
        )}
      </div>

      <SensorInspectionSheet sensor={selectedSensor} active={selectedSensor?.active !== false} onToggleStatus={() => { if (selectedSensor) void toggleSensorStatus(selectedSensor.id); }} history={selectedSensor ? historyRef.current[selectedSensor.id] ?? [] : []} open={selectedSensor !== null} stale={Boolean(error)} returnFocusRef={inspectTriggerRef} returnFocusFallbackRef={statusFilterRef} onOpenChange={(open) => { if (!open) setSelectedSensorId(null); }} />
    </main>
  );
}
