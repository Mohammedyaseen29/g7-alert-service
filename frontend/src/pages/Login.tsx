import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, CircleAlert, LockKeyhole } from 'lucide-react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { unlockAlarmAudio } from '../alarmAudio.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card.js';

export function Login() {
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const auth = useAuth();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErr('');
    setBusy(true);
    try {
      // A user gesture on submit is the most reliable place to unlock browser audio.
      await unlockAlarmAudio();
      const r = await api.login(u, p);
      localStorage.setItem('g7_username', r.user.username);
      auth.login(r.access, r.user.role);
      nav('/', { replace: true });
    } catch {
      setErr('Unable to sign in with those credentials.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-[calc(100vh-1px)] w-full max-w-none items-center overflow-hidden bg-slate-950 px-4 py-10 sm:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(20,184,166,.2),transparent_32%),radial-gradient(circle_at_90%_85%,rgba(14,165,233,.16),transparent_30%)]" />
      <div className="relative mx-auto grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[1fr_420px] lg:gap-20">
        <section className="hidden text-white lg:block">
          <div className="mb-8">
            <div>
              <p className="text-lg font-semibold tracking-[.24em]">PRIDE MONITOR</p>
              <p className="mt-1 text-xs font-medium tracking-[.28em] text-cyan-200/60">INDUSTRIAL IOT</p>
            </div>
          </div>
          <p className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-white xl:text-5xl">Operational clarity for every connected sensor.</p>
          <p className="mt-6 max-w-lg text-base leading-7 text-slate-300">Monitor base-station health, review alarm activity, and keep your plant data moving with confidence.</p>
          <div className="mt-10 flex flex-wrap gap-3 text-xs text-slate-300">
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Secure access</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Live telemetry</span>
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-2">Alarm response</span>
          </div>
        </section>

        <Card className="border-white/10 bg-white shadow-2xl shadow-slate-950/40">
          <CardHeader className="space-y-3 p-6 sm:p-8">
            <div className="text-xs font-semibold uppercase tracking-[.18em] text-teal-700 lg:hidden">Pride Monitor</div>
            <CardTitle className="text-2xl tracking-tight text-slate-950">Welcome back</CardTitle>
            <CardDescription className="text-sm leading-6 text-slate-500">Sign in to access your industrial monitoring workspace.</CardDescription>
          </CardHeader>
          <form onSubmit={submit}>
            <CardContent className="space-y-5 px-6 sm:px-8">
              <div className="space-y-2">
                <label htmlFor="username" className="text-sm font-medium text-slate-700">Username</label>
                <input id="username" data-ui-input value={u} onChange={(event) => setU(event.target.value)} autoComplete="username" required className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" />
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="password" className="text-sm font-medium text-slate-700">Password</label>
                  <LockKeyhole className="size-4 text-slate-400" aria-hidden="true" />
                </div>
                <input id="password" data-ui-input type="password" value={p} onChange={(event) => setP(event.target.value)} autoComplete="current-password" required className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10" />
              </div>
              {err && <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-700"><CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" /><span>{err}</span></div>}
            </CardContent>
            <CardFooter className="flex-col items-stretch gap-4 px-6 pb-6 pt-6 sm:px-8 sm:pb-8">
              <Button type="submit" disabled={busy} className="h-11 w-full gap-2 bg-teal-700 text-white hover:bg-teal-800">
                {busy ? 'Signing in…' : 'Sign in'}
                {!busy && <ArrowRight className="size-4" aria-hidden="true" />}
              </Button>
              <p className="text-center text-xs leading-5 text-slate-400">Use your authorized Pride Monitor account to continue.</p>
            </CardFooter>
          </form>
        </Card>
      </div>
    </main>
  );
}
