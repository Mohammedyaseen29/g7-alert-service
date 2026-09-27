import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button.js';
import { api } from '../api.js';
import type { AlarmConfig } from '../types.js';
import { validateConfig } from '../types.js';
import { useAuth } from '../auth.js';

export function AlarmConfigPage() {
  const { id } = useParams();
  const auth = useAuth();
  const [cfg, setCfg] = useState<AlarmConfig & { fields?: Record<string, string>; name?: string; secondaryRole?: 'unclassified' | 'humidity' | 'temperature2' }>({});
  const [errs, setErrs] = useState<string[]>([]);
  const [msg, setMsg] = useState('');
  const canEdit = auth.role === 'ADMIN' || auth.role === 'OPERATOR';
  useEffect(() => { (async () => {
    if (!id) return;
    const config = await api.getConfig(id) as AlarmConfig;
    setCfg({ ...config, delaySeconds: config.delaySeconds !== undefined && config.delaySeconds >= 60 ? config.delaySeconds : 900 });
  })(); }, [id]);
  return (
    <main style={{ maxWidth: 560 }}>
      <Button variant="outline" className="mb-3 gap-2" asChild><Link to="/"><ArrowLeft className="size-4" />Back to sensors</Link></Button>
      <div className="card">
        <h2>Sensor {id} — Alarm configuration</h2>
        <div className="notice">An alarm starts only after a reading stays out of range, or a sensor stays disconnected, for the delay set below. Brief interruptions will not alert.</div>
        {!canEdit && <div className="error">VIEWER role: read-only.</div>}
        <label>Sensor name</label>
        <input value={cfg.name ?? ''} disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, name: e.target.value })} />
        <label htmlFor="alarm-delay">Alarm delay (minutes)</label>
        <input id="alarm-delay" type="number" min="1" max="1440" step="1" value={cfg.delaySeconds === 0 ? '' : (cfg.delaySeconds ?? 900) / 60} disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, delaySeconds: Number(e.target.value) * 60 })} />
        <p className="mt-1 text-sm text-slate-500">Applies to temperature, humidity, battery, and sensor disconnect alarms. Default: 15 minutes. Choose 1 to 1,440 minutes.</p>
        {(cfg.fields?.secondary || cfg.fields?.humidity || cfg.fields?.temperature2) && <>
          <label>Secondary channel measurement</label>
          <select value={cfg.secondaryRole ?? 'unclassified'} disabled={!canEdit} onChange={(e) => setCfg({ ...cfg, secondaryRole: e.target.value as 'unclassified' | 'humidity' | 'temperature2' })}>
            <option value="unclassified">Not identified yet</option>
            <option value="humidity">Humidity</option>
            <option value="temperature2">Second temperature</option>
          </select>
        </>}
        <label><input type="checkbox" style={{ width: 'auto' }} checked={cfg.temperature?.enabled ?? true} onChange={(e) => setCfg({ ...cfg, temperature: { ...cfg.temperature, enabled: e.target.checked } })} /> Temperature alarm enabled</label>
        <label>High temperature (°C)</label>
        <input type="number" step="0.1" value={cfg.temperature?.high ?? 30} onChange={(e) => setCfg({ ...cfg, temperature: { ...cfg.temperature, high: Number(e.target.value) } })} />
        <label>Low temperature (°C)</label>
        <input type="number" step="0.1" value={cfg.temperature?.low ?? 10} onChange={(e) => setCfg({ ...cfg, temperature: { ...cfg.temperature, low: Number(e.target.value) } })} />
        {(cfg.fields?.humidity || cfg.secondaryRole === 'humidity') && <>
          <label><input type="checkbox" style={{ width: 'auto' }} checked={cfg.humidity?.enabled ?? true} onChange={(e) => setCfg({ ...cfg, humidity: { ...cfg.humidity, enabled: e.target.checked } })} /> Humidity alarm enabled</label>
          <label>High humidity (%)</label>
          <input type="number" step="0.1" value={cfg.humidity?.high ?? 80} onChange={(e) => setCfg({ ...cfg, humidity: { ...cfg.humidity, enabled: cfg.humidity?.enabled, high: Number(e.target.value), low: cfg.humidity?.low } })} />
          <label>Low humidity (%)</label>
          <input type="number" step="0.1" value={cfg.humidity?.low ?? 20} onChange={(e) => setCfg({ ...cfg, humidity: { ...cfg.humidity, low: Number(e.target.value) } })} />
        </>}
        {cfg.secondaryRole === 'unclassified' && cfg.fields?.secondary && <div className="notice warning">Channel {cfg.fields.secondary} was received from the base station, but its measurement type is not identified. Choose its meaning before alarms are applied to that channel.</div>}
        {cfg.secondaryRole === 'temperature2' && <div className="notice success">The high and low temperature limits apply to both temperature channels.</div>}
        <label><input type="checkbox" style={{ width: 'auto' }} checked={cfg.battery?.enabled ?? true} onChange={(e) => setCfg({ ...cfg, battery: { ...cfg.battery, enabled: e.target.checked } })} /> Battery alarm enabled</label>
        <label>Low battery (V)</label>
        <input type="number" step="0.01" value={cfg.battery?.low ?? 3.3} onChange={(e) => setCfg({ ...cfg, battery: { ...cfg.battery, low: Number(e.target.value) } })} />
        {errs.map((e) => <div key={e} className="error">{e}</div>)}
        {msg && <div style={{ color: '#15803d' }}>{msg}</div>}
        <button disabled={!canEdit} onClick={async () => {
          const v = validateConfig(cfg);
          setErrs(v);
          if (v.length) return;
          try {
            if (!cfg.name?.trim()) {
              setErrs(['Sensor name is required.']);
              return;
            }
            await api.putSensorDefinition(id!, { name: cfg.name.trim(), secondaryRole: cfg.secondaryRole ?? 'unclassified' });
            const { fields: _fields, name: _name, secondaryRole: _secondaryRole, ...alarmConfig } = cfg;
            await api.putConfig(id!, alarmConfig);
            setMsg('Node configuration saved.');
          } catch (e) {
            setErrs([String(e)]);
          }
        }}>Save configuration</button>
      </div>
    </main>
  );
}
