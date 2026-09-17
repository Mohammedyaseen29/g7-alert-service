import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import type { Sensor } from '../types.js';
import { useLiveSensors } from '../hooks.js';

function ago(iso?: string): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? `${s}s ago` : `${Math.floor(s / 60)}m ago`;
}

export function Dashboard() {
  const [sensors, setSensors] = useState<Sensor[]>([]);
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const load = useCallback(async () => {
    try {
      setSensors(await api.sensors());
      setStatus(await api.status());
    } catch { /* unauthorized handled globally */ }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 10_000); return () => clearInterval(t); }, [load]);
  const live = useLiveSensors(load);
  const connection = String(status?.g7 ?? 'CHECKING');
  const connectionClass = connection === 'LIVE' ? 'ok' : connection === 'CONNECTED' ? 'waiting' : 'alarm';
  return (
    <main>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="dashboard-status">
          <strong>Base station</strong>
          <span className={`badge ${connectionClass}`}>{connection}</span>
        </div>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          Last data: {ago(status?.lastMessage as string)} · Online sensors: {String(status?.activeSensors ?? '…')} · Active alarms: {String(status?.activeAlarms ?? '…')} · Notification recipients: {String(status?.notificationRecipients ?? '…')} · Updates: {live ? 'live' : 'polling'}
        </div>
      </div>
      {sensors.length === 0 && (
        <div className="card empty-state">
          <div className="empty-icon">⌁</div>
          <h2>No sensors discovered yet</h2>
          <p>Sensor cards will appear automatically after the base station connects and sends its first valid data message.</p>
        </div>
      )}
      <div className="grid">
        {sensors.map((s) => (
          <Link key={s.id} to={`/sensors/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <strong>Sensor {s.id}</strong>
                <span className={`badge ${s.activeAlarmCount ? 'alarm' : s.online ? 'ok' : 'offline'}`}>{s.activeAlarmCount ? 'Alarm' : s.online ? 'Normal' : 'Offline'}</span>
              </div>
              <div style={{ fontSize: 13, color: '#64748b' }}>{s.name}</div>
              {s.reading?.temperature !== undefined && <div>Temperature: <b>{s.reading.temperature.toFixed(2)}°C</b></div>}
              {s.reading?.temperature2 !== undefined && <div>Temperature 2: <b>{s.reading.temperature2.toFixed(2)}°C</b></div>}
              {s.reading?.humidity !== undefined && <div>Humidity: <b>{s.reading.humidity.toFixed(2)}%</b></div>}
              {s.reading?.secondary !== undefined && <div>Secondary channel: <b>{s.reading.secondary.toFixed(2)}</b></div>}
              {s.reading?.battery !== undefined && <div>Battery: <b>{s.reading.battery.toFixed(3)}V</b></div>}
              <div style={{ fontSize: 12, color: '#64748b' }}>Last seen: {ago(s.reading?.lastSeen)}</div>
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
