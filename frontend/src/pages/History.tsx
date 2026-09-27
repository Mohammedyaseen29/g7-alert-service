import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, Download, FileText, RefreshCw, Thermometer } from 'lucide-react';
import { api, downloadReadingExport, downloadSensorReport, type ReadingExport } from '../api.js';
import type { Sensor } from '../types.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';

type Period = 'day' | 'week' | 'month' | 'all' | 'custom';
const periods: { value: Period; label: string }[] = [
  { value: 'day', label: '24 hours' }, { value: 'week', label: '7 days' },
  { value: 'month', label: '30 days' }, { value: 'all', label: 'All available' },
  { value: 'custom', label: 'Custom dates' },
];

function displayTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'No saved readings yet';
}

function errorText(_error: unknown): string {
  return 'Unable to load sensor history right now. Please try again.';
}

export function History() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [period, setPeriod] = useState<Period>('day');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [availability, setAvailability] = useState<{ first: string | null; last: string | null; archiveConfigured: boolean; hotDays: number; exportTtlDays: number } | null>(null);
  const [jobs, setJobs] = useState<ReadingExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const availabilityRequest = useRef(0);

  const refreshAvailability = useCallback(async () => {
    const requestId = ++availabilityRequest.current;
    setAvailabilityLoading(true);
    try {
      const range = await api.readingAvailability(selected);
      if (requestId === availabilityRequest.current) { setAvailability(range); setError(null); }
    } catch (cause) {
      if (requestId === availabilityRequest.current) { setAvailability(null); setError(errorText(cause)); }
    } finally {
      if (requestId === availabilityRequest.current) setAvailabilityLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    let active = true;
    void Promise.all([api.sensors(), api.readingExports()]).then(([sensorList, exportList]) => {
      if (active) { setSensors(sensorList); setJobs(exportList); setError(null); }
    }).catch((cause) => { if (active) setError(errorText(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => { void refreshAvailability(); }, [refreshAvailability]);

  useEffect(() => {
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshAvailability(); };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [refreshAvailability]);

  useEffect(() => {
    if (!jobs.some((job) => job.status === 'PENDING' || job.status === 'PROCESSING')) return;
    const timer = window.setInterval(() => { void api.readingExports().then(setJobs).catch(() => {}); }, 5_000);
    return () => window.clearInterval(timer);
  }, [jobs]);

  const selectedNames = useMemo(() => selected.length === 0 ? 'All sensors' : `${selected.length} sensor${selected.length === 1 ? '' : 's'}`, [selected]);
  const toggleSensor = (id: string) => setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);

  const selectedPeriodRange = (): { from?: string; to?: string } => {
    const now = new Date();
    if (period === 'custom') {
      if (!customFrom || !customTo) throw new Error('Choose both start and end dates.');
      const start = new Date(customFrom);
      const end = new Date(customTo);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end || end > now) {
        throw new Error('Choose a valid range ending no later than now.');
      }
      return { from: start.toISOString(), to: end.toISOString() };
    }
    if (period === 'all') return { to: now.toISOString() };
    const days = period === 'day' ? 1 : period === 'week' ? 7 : 30;
    return { from: new Date(now.getTime() - days * 86_400_000).toISOString(), to: now.toISOString() };
  };

  const createExport = async () => {
    setError(null);
    setNotice(null);
    let range: { from?: string; to?: string };
    try { range = selectedPeriodRange(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Choose a valid time period.'); return; }
    setSubmitting(true);
    try {
      const job = await api.createReadingExport({ sensorIds: selected, ...range });
      setJobs((current) => [job, ...current]);
      setNotice('Your CSV is being prepared. You can leave this page and return to download it later.');
    } catch (cause) { setError(errorText(cause)); }
    finally { setSubmitting(false); }
  };

  const createReport = async () => {
    setError(null);
    setNotice(null);
    let range: { from?: string; to?: string };
    try { range = selectedPeriodRange(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Choose a valid time period.'); return; }
    setReportLoading(true);
    try {
      if (period === 'all') {
        const activeIds = sensors.filter((sensor) => sensor.active !== false).map((sensor) => sensor.id);
        const activeAvailability = await api.readingAvailability(activeIds);
        range.from = activeAvailability.first ?? new Date(Date.now() - 86_400_000).toISOString();
      }
      await downloadSensorReport(range);
      setNotice('Your one-page A4 graph report has been downloaded. It includes every active sensor.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not download the graph report.'); }
    finally { setReportLoading(false); }
  };

  const download = async (id: string) => {
    const job = jobs.find((item) => item.id === id);
    if (!job) return;
    try {
      await downloadReadingExport(job);
    } catch (cause) { setError(errorText(cause)); }
  };

  return (
    <main className="min-h-[calc(100vh-64px)] bg-[#f8faf9] px-4 py-6 text-slate-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.2em] text-teal-700">Tempmo · records</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[#0b1f2a]">Sensor history</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">Download saved readings as CSV or a one-page A4 graph report for all active sensors.</p>
        </header>

        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
        {notice && <div role="status" className="rounded-xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">{notice}</div>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><CalendarDays className="size-5 text-teal-700" />Create export</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-800">Time period</p>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Time period">
                  {periods.map((item) => <Button key={item.value} type="button" size="sm" variant={period === item.value ? 'default' : 'outline'} aria-pressed={period === item.value} onClick={() => setPeriod(item.value)}>{item.label}</Button>)}
                </div>
                {period === 'custom' && <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="text-xs font-medium text-slate-600">From<input type="datetime-local" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" /></label>
                  <label className="text-xs font-medium text-slate-600">To<input type="datetime-local" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900" /></label>
                </div>}
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between gap-3"><p className="m-0 text-sm font-semibold text-slate-800">Sensors</p><Button type="button" variant="ghost" size="sm" onClick={() => setSelected([])}>All sensors</Button></div>
                <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
                  {loading ? <p className="px-2 text-sm text-slate-500">Loading sensors…</p> : sensors.length === 0 ? <p className="px-2 text-sm text-slate-500">No sensors discovered yet.</p> : sensors.map((sensor) => <label key={sensor.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-white"><input type="checkbox" checked={selected.includes(sensor.id)} onChange={() => toggleSensor(sensor.id)} className="size-4 accent-teal-700" /><span className="truncate font-medium">{sensor.name}</span><span className="ml-auto font-mono text-xs text-slate-400">{sensor.id}</span></label>)}
                </div>
                <p className="mt-2 text-xs text-slate-500">No boxes selected means all sensors. Current selection: {selectedNames}.</p>
              </div>
              <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-5">
                <Button type="button" className="gap-2" disabled={submitting || availabilityLoading || !availability?.first} onClick={() => { void createExport(); }}><Download className="size-4" />{submitting ? 'Preparing…' : 'Prepare CSV'}</Button>
                <Button type="button" variant="outline" className="gap-2" disabled={reportLoading || loading || !sensors.some((sensor) => sensor.active !== false)} onClick={() => { void createReport(); }}><FileText className="size-4" />{reportLoading ? 'Building report…' : 'Download A4 graphs'}</Button>
                <span className="w-full text-xs text-slate-500">The graph report uses this time period and includes every configured, active sensor. Inactive sensors are excluded.</span>
                <span className="text-xs text-slate-500">CSV downloads are prepared in Oracle Object Storage and remain available for {availability?.exportTtlDays ?? 7} days.</span>
                {availability && !availability.first && <span role="status" className="w-full text-xs text-amber-800">No saved readings are available for the selected sensors.</span>}
                {availabilityLoading && <span role="status" className="w-full text-xs text-slate-500">Checking saved readings…</span>}
              </div>
            </CardContent>
          </Card>
          <Card className="h-fit border-slate-200 bg-white shadow-sm">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDays className="size-4 text-teal-700" />Available data</CardTitle></CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div><p className="m-0 text-xs uppercase tracking-wider text-slate-500">First saved reading</p><p className="mt-1 font-medium text-slate-900">{displayTime(availability?.first)}</p></div>
              <div><p className="m-0 text-xs uppercase tracking-wider text-slate-500">Latest saved reading</p><p className="mt-1 font-medium text-slate-900">{displayTime(availability?.last)}</p></div>
              <p className="m-0 text-xs leading-relaxed text-slate-500">History is available from the date this feature was enabled. Earlier readings may not be available.</p>
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex-row items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-lg"><Thermometer className="size-5 text-teal-700" />Your exports</CardTitle><Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => { void api.readingExports().then(setJobs).catch((cause) => setError(errorText(cause))); }}><RefreshCw className="size-3.5" />Refresh</Button></CardHeader>
          <CardContent>
            {jobs.length === 0 ? <p className="py-5 text-sm text-slate-500">No exports requested yet.</p> : <div className="space-y-2">{jobs.map((job) => <div key={job.id} className="flex flex-col gap-3 rounded-xl border border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="m-0 text-sm font-semibold text-slate-900">{new Date(job.from).toLocaleDateString()} – {new Date(job.to).toLocaleDateString()} · {job.sensorIds.length ? `${job.sensorIds.length} sensors` : 'All sensors'}</p><p className="mt-1 text-xs text-slate-500">{job.status === 'DONE' ? `${Number(job.rowCount ?? 0).toLocaleString()} readings · ready to download` : job.status === 'FAILED' ? (job.error ?? 'Export failed') : job.status === 'PROCESSING' ? `${Number(job.rowCount ?? 0).toLocaleString()} readings processed` : 'Waiting to start'}</p></div>{job.status === 'DONE' ? <Button type="button" size="sm" variant="outline" className="gap-2" onClick={() => { void download(job.id); }}><Download className="size-4" />Download</Button> : <span className={`text-xs font-semibold uppercase tracking-wider ${job.status === 'FAILED' ? 'text-rose-700' : 'text-teal-700'}`}>{job.status.toLowerCase()}</span>}</div>)}</div>}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
