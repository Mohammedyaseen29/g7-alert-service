import { useCallback, useEffect, useState } from 'react';
import { BellRing, CircleCheck, Clock3, RefreshCw } from 'lucide-react';
import { api } from '../api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';

interface Alarm { sensorId: string; kind: string; message?: string; value?: number; startedAt: string; recoveredAt?: string }
interface AlarmData { active: Alarm[]; history: Alarm[] }
const time = (value?: string) => value ? new Date(value).toLocaleString() : '—';
const label = (value: string) => value.replace(/_/g, ' ');

export function Alarms() {
  const [data, setData] = useState<AlarmData | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setData(await api.alarms() as AlarmData); setError(''); }
    catch { setError('Unable to refresh alarms. Previously loaded records may be out of date.'); }
  }, []);
  useEffect(() => { void load(); const timer = setInterval(() => void load(), 10000); return () => clearInterval(timer); }, [load]);
  return <main className="mx-auto w-full max-w-[1440px] space-y-6 px-4 py-8 sm:px-8 lg:px-10">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-xs font-semibold uppercase tracking-[.2em] text-teal-700">Event management</p><h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">Alarm activity</h1><p className="mt-2 text-sm text-slate-500">Monitor active alerts and review recovery events.</p></div>
      <Button variant="outline" onClick={() => void load()}><RefreshCw className="mr-2 size-4" />Refresh</Button>
    </div>
    {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{error}</p>}
    {!data ? <p role="status" className="py-12 text-center text-slate-500">{error ? 'Alarm data is unavailable.' : 'Loading alarm activity…'}</p> : <>
      <Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle className="flex items-center gap-3 text-lg"><BellRing className="size-5 text-rose-500" />Active alarms</CardTitle><Badge variant="outline">{data.active.length} active</Badge></CardHeader>
        <CardContent>{data.active.length === 0 ? <div className="flex items-center gap-4 rounded-xl bg-teal-50 p-6 text-teal-800"><CircleCheck className="size-6 shrink-0" /><div><p className="font-medium">No active alarms reported</p><p className="mt-1 text-sm text-teal-700">Check Sensors for current connection and measurement status.</p></div></div> : <div className="divide-y divide-slate-100">{data.active.map((alarm, i) => <div key={`${alarm.sensorId}-${alarm.kind}-${i}`} className="flex flex-wrap items-start justify-between gap-3 py-4"><div><p className="font-semibold text-slate-900">Sensor {alarm.sensorId} <span className="ml-2 text-sm font-medium capitalize text-rose-600">{label(alarm.kind)}</span></p><p className="mt-1 text-sm text-slate-600">{alarm.message}</p></div><time className="text-xs text-slate-500">{time(alarm.startedAt)}</time></div>)}</div>}</CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-3 text-lg"><Clock3 className="size-5 text-slate-400" />Event history</CardTitle></CardHeader><CardContent>
        {data.history.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">No alarm history reported yet.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="text-xs uppercase tracking-wide text-slate-500"><th className="p-3">Sensor</th><th className="p-3">Event</th><th className="p-3">Value</th><th className="p-3">Detected</th><th className="p-3">Recovered</th></tr></thead><tbody>{data.history.slice(0, 100).map((alarm, i) => <tr key={`${alarm.sensorId}-${alarm.startedAt}-${i}`} className="border-t border-slate-100"><td className="whitespace-nowrap p-3 font-medium">Sensor {alarm.sensorId}</td><td className="whitespace-nowrap p-3 capitalize">{label(alarm.kind)}</td><td className="p-3 tabular-nums">{alarm.value ?? '—'}</td><td className="whitespace-nowrap p-3 text-slate-500">{time(alarm.startedAt)}</td><td className="whitespace-nowrap p-3 text-slate-500">{alarm.recoveredAt ? time(alarm.recoveredAt) : 'No recovery recorded'}</td></tr>)}</tbody></table></div>}
      </CardContent></Card>
    </>}
  </main>;
}
