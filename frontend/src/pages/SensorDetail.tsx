import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api.js';
import type { Sensor } from '../types.js';

export function SensorDetail() {
  const { id } = useParams();
  const [s, setS] = useState<(Sensor & { activeAlarms: { kind: string; message: string }[] }) | null>(null);
  const [hist, setHist] = useState<{ kind: string; value?: number; startedAt: string; recoveredAt?: string }[]>([]);
  useEffect(() => {
    (async () => {
      if (!id) return;
      setS((await api.sensor(id)) as typeof s);
      const h = await fetch(`/api/sensors/${id}/history`, { headers: { Authorization: `Bearer ${localStorage.getItem('g7_token')}` } }).then((r) => r.json()).catch(() => []);
      setHist(h);
    })();
  }, [id]);
  if (!s) return <main>Loading…</main>;
  const thresholds = s.thresholds ?? {};
  return (
    <main>
      <Link to="/">← Dashboard</Link>
      <div className="card" style={{ marginTop: 8 }}>
        <h2>Sensor {s.id} — {s.name}</h2>
        <div>Sensor ID: {s.id}</div>
        {s.reading?.temperature !== undefined && <div>Temperature: <b>{s.reading.temperature}°C</b></div>}
        {s.reading?.temperature2 !== undefined && <div>Temperature 2: <b>{s.reading.temperature2}°C</b></div>}
        {s.reading?.humidity !== undefined && <div>Humidity: <b>{s.reading.humidity}%</b></div>}
        {s.reading?.secondary !== undefined && <div>Secondary channel ({s.fields.secondary}): <b>{s.reading.secondary}</b></div>}
        {s.reading?.battery !== undefined && <div>Battery: <b>{s.reading.battery}V</b></div>}
        <div>Status: {s.reading ? 'Connected' : 'No data'}</div>
        <div>Last seen: {s.reading?.lastSeen ?? 'never'}</div>
        <h3>Thresholds</h3>
        <div className="threshold-grid">
          <div className={`threshold-card ${thresholds.temperature?.enabled === false ? 'disabled' : ''}`}>
            <span className="metric-icon temperature">°C</span>
            <div><strong>Temperature{s.fields.temperature2 ? ' channels' : ''}</strong><small>{thresholds.temperature?.enabled === false ? 'Disabled' : s.fields.temperature2 ? 'Alarm range for both channels' : 'Alarm range'}</small></div>
            <div className="threshold-values"><span>Low <b>{thresholds.temperature?.low ?? '—'}°</b></span><span>High <b>{thresholds.temperature?.high ?? '—'}°</b></span></div>
          </div>
          {s.fields.humidity && <div className={`threshold-card ${thresholds.humidity?.enabled === false ? 'disabled' : ''}`}>
            <span className="metric-icon humidity">%</span>
            <div><strong>Humidity</strong><small>{thresholds.humidity?.enabled === false ? 'Disabled' : 'Alarm range'}</small></div>
            <div className="threshold-values"><span>Low <b>{thresholds.humidity?.low ?? '—'}%</b></span><span>High <b>{thresholds.humidity?.high ?? '—'}%</b></span></div>
          </div>}
          <div className={`threshold-card ${thresholds.battery?.enabled === false ? 'disabled' : ''}`}>
            <span className="metric-icon battery">V</span>
            <div><strong>Battery</strong><small>{thresholds.battery?.enabled === false ? 'Disabled' : 'Low battery alarm'}</small></div>
            <div className="threshold-values single"><span>Alert below <b>{thresholds.battery?.low ?? '—'}V</b></span></div>
          </div>
        </div>
        <Link to={`/sensors/${s.id}/config`}>Edit alarm configuration →</Link>
        <h3>Active alarms ({s.activeAlarms.length})</h3>
        {s.activeAlarms.map((a, i) => <div key={i} className="badge alarm">{a.kind}: {a.message}</div>)}
        <h3>Recent history</h3>
        <table><tbody>
          {hist.slice(0, 20).map((h, i) => <tr key={i}><td>{h.kind}</td><td>{h.value ?? ''}</td><td>{h.startedAt}</td><td>{h.recoveredAt ?? 'active'}</td></tr>)}
        </tbody></table>
      </div>
    </main>
  );
}
