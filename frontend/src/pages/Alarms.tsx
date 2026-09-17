import { useEffect, useState } from 'react';
import { api } from '../api.js';

export function Alarms() {
  const [d, setD] = useState<{ active: { sensorId: string; kind: string; message: string; startedAt: string }[]; history: { sensorId: string; kind: string; value?: number; startedAt: string; recoveredAt?: string }[] } | null>(null);
  useEffect(() => { (api.alarms() as Promise<typeof d>).then(setD).catch(() => {}); }, []);
  if (!d) return <main>Loading…</main>;
  return (
    <main>
      <div className="card"><h2>Active alarms ({d.active.length})</h2>
        {d.active.map((a, i) => <div key={i}>[{a.sensorId}] {a.kind} — {a.message} ({a.startedAt})</div>)}
      </div>
      <div className="card" style={{ marginTop: 12 }}><h2>History</h2>
        <table><tbody>
          {d.history.slice(0, 100).map((h, i) => <tr key={i}><td>{h.sensorId}</td><td>{h.kind}</td><td>{h.value ?? ''}</td><td>{h.startedAt}</td><td>{h.recoveredAt ?? 'active'}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
