import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { unlockAlarmAudio } from '../alarmAudio.js';

export function Login() {
  const [u, setU] = useState('admin');
  const [p, setP] = useState('admin123');
  const [err, setErr] = useState('');
  const nav = useNavigate();
  const auth = useAuth();
  return (
    <main style={{ maxWidth: 420 }}>
      <div className="card">
        <h2>G7 Alert Service — Login</h2>
        <label>Username</label>
        <input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" />
        <label>Password</label>
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" />
        {err && <div className="error">{err}</div>}
        <button onClick={async () => {
          try {
            await unlockAlarmAudio();
            const r = await api.login(u, p);
            auth.login(r.access, r.user.role);
            nav('/');
          } catch {
            setErr('Invalid credentials');
          }
        }}>Login</button>
        <p style={{ fontSize: 13, color: '#64748b' }}>Default: admin / admin123 (change after first login). <Link to="/health-note">Health</Link></p>
      </div>
    </main>
  );
}
