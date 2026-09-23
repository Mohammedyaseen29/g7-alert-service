import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Activity, ChevronDown, CircleAlert, LogOut, UserRound } from 'lucide-react';
import { AuthProvider, useAuth } from './auth.js';
import { api } from './api.js';
import { Login } from './pages/Login.js';
import { Dashboard } from './pages/Dashboard.js';
import { SensorDetail } from './pages/SensorDetail.js';
import { AlarmConfigPage } from './pages/AlarmConfig.js';
import { Alarms } from './pages/Alarms.js';
import { Notifications } from './pages/Notifications.js';
import { History } from './pages/History.js';
import { AlarmSound } from './AlarmSound.js';
import { PwaControls } from './PwaControls.js';
import { Badge } from './components/ui/badge.js';
import { Button } from './components/ui/button.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from './components/ui/dropdown-menu.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs.js';
import './styles.css';

interface SystemStatus {
  g7?: unknown;
  activeSensors?: unknown;
  activeAlarms?: unknown;
}

interface StatusState {
  data: SystemStatus | null;
  error: boolean;
  loading: boolean;
}

function Guard({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  return token ? children : <Navigate to="/login" replace />;
}

function useSystemStatus(enabled: boolean): StatusState {
  const [data, setData] = useState<SystemStatus | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(enabled);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    if (!enabled) {
      setData(null);
      setError(false);
      setLoading(false);
      return () => { cancelled = true; };
    }

    const load = async () => {
      try {
        const next = await api.status();
        if (cancelled) return;
        setData(next);
        setError(false);
      } catch {
        if (cancelled) return;
        // Keep the last response for diagnostics, but do not present stale data as live.
        setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    timer = window.setInterval(() => { void load(); }, 10_000);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [enabled]);

  return { data, error, loading };
}

function activeAlarmCount(status: SystemStatus | null): number | null {
  const count = status?.activeAlarms;
  return typeof count === 'number' && Number.isFinite(count) && count >= 0 ? Math.floor(count) : null;
}

function displayRole(role: string | null): string {
  if (!role) return 'Authenticated user';
  return role.toLowerCase().replace(/(^|_)./g, (value) => value.toUpperCase());
}

function connectionState(status: StatusState): { label: string; tone: string; dot: string; pulse: boolean } {
  if (status.error) return { label: 'Status unavailable', tone: 'border-slate-500/60 bg-slate-800/70 text-slate-300', dot: 'bg-slate-400', pulse: false };
  if (status.loading || !status.data) return { label: 'Checking connection', tone: 'border-slate-500/60 bg-slate-800/70 text-slate-300', dot: 'bg-slate-400', pulse: false };

  switch (status.data.g7) {
    case 'LIVE': {
      const count = status.data.activeSensors;
      const online = typeof count === 'number' && Number.isFinite(count) && count >= 0 ? ` · ${Math.floor(count)} sensor${count === 1 ? '' : 's'} online` : '';
      return { label: `Base station live${online}`, tone: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100', dot: 'bg-emerald-300', pulse: true };
    }
    case 'CONNECTED':
      return { label: 'Connected · waiting for data', tone: 'border-amber-300/40 bg-amber-300/10 text-amber-100', dot: 'bg-amber-300', pulse: false };
    case 'DISCONNECTED':
      return { label: 'Base station disconnected', tone: 'border-rose-300/40 bg-rose-300/10 text-rose-100', dot: 'bg-rose-300', pulse: false };
    default:
      return { label: 'Status unavailable', tone: 'border-slate-500/60 bg-slate-800/70 text-slate-300', dot: 'bg-slate-400', pulse: false };
  }
}

function AlarmBadge({ status }: { status: StatusState }) {
  const count = activeAlarmCount(status.data);
  if (status.error) {
    return <Badge variant="destructive" aria-label="Alarm count unavailable" title="Alarm count unavailable">!</Badge>;
  }
  if (status.loading || !status.data) {
    return <Badge variant="secondary" aria-label="Loading active alarm count">…</Badge>;
  }
  if (count === null) {
    return <Badge variant="outline" aria-label="Alarm count unavailable" title="Alarm count unavailable">—</Badge>;
  }
  return <Badge variant={count > 0 ? 'destructive' : 'secondary'} aria-label={`${count} active alarm${count === 1 ? '' : 's'}`}>{count}</Badge>;
}

function Brand() {
  return (
    <div className="min-w-0 leading-none" aria-label="Pride Monitor">
        <span className="block truncate text-sm font-semibold tracking-[.22em] text-white">PRIDE MONITOR</span>
        <span className="mt-1 block truncate text-[10px] font-medium tracking-[.2em] text-cyan-200/70">INDUSTRIAL IOT</span>
    </div>
  );
}

function UserMenu() {
  const { role, logout } = useAuth();
  const navigate = useNavigate();
  const username = localStorage.getItem('g7_username') || 'Account';
  const roleName = displayRole(role);

  const signOut = () => {
    logout();
    localStorage.removeItem('g7_username');
    navigate('/login', { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-10 gap-2 rounded-xl px-2 text-slate-100 hover:bg-white/10 hover:text-white" aria-label="Open user menu">
          <span className="grid size-7 place-items-center rounded-lg bg-white/10 text-cyan-100"><UserRound className="size-4" aria-hidden="true" /></span>
          <span className="hidden max-w-28 truncate text-left text-xs font-medium sm:block">{username}</span>
          <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-sm font-medium">{username}</span>
          <span className="mt-1 block text-xs font-normal text-slate-500">{roleName}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut} className="text-rose-700 focus:bg-rose-50 focus:text-rose-700">
          <LogOut className="mr-2 size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppRoutes({ token }: { token: string | null }) {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={<Guard><Dashboard /></Guard>} />
      <Route path="/sensors/:id" element={<Guard><SensorDetail /></Guard>} />
      <Route path="/sensors/:id/config" element={<Guard><AlarmConfigPage /></Guard>} />
      <Route path="/alarms" element={<Guard><Alarms /></Guard>} />
      <Route path="/history" element={<Guard><History /></Guard>} />
      <Route path="/notifications" element={<Guard><Notifications /></Guard>} />
      <Route path="/settings" element={<Guard><Navigate to="/notifications" replace /></Guard>} />
      <Route path="*" element={<Navigate to={token ? '/' : '/login'} replace />} />
    </Routes>
  );
}

function Shell() {
  const { token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const status = useSystemStatus(Boolean(token));
  const activeTab = useMemo(() => {
    if (location.pathname === '/alarms') return '/alarms';
    if (location.pathname === '/history') return '/history';
    if (location.pathname === '/notifications' || location.pathname === '/settings') return '/notifications';
    return '/';
  }, [location.pathname]);
  const connection = connectionState(status);

  if (!token) return <AppRoutes token={token} />;

  return (
    <Tabs value={activeTab} onValueChange={(value) => { void navigate(value); }} className="min-h-screen">
        <header className="block p-0 sticky top-0 z-40 border-b border-slate-800/90 bg-[#0b1f3a] text-white shadow-lg shadow-slate-950/10">
          <div className="mx-auto flex min-h-[72px] w-full max-w-[1440px] flex-wrap items-center gap-4 px-4 py-3 sm:px-8 lg:px-10">
            <Brand />

            <div className="order-3 w-full md:order-2 md:w-auto md:flex-1">
              <TabsList className="h-10 w-full justify-start gap-1 overflow-x-auto bg-transparent p-0 md:w-auto">
                <TabsTrigger value="/" className="h-10 rounded-lg px-3 text-xs font-medium text-slate-300 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                  Sensors
                </TabsTrigger>
                <TabsTrigger value="/alarms" className="h-10 gap-2 rounded-lg px-3 text-xs font-medium text-slate-300 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                  Alarms
                  <AlarmBadge status={status} />
                </TabsTrigger>
                <TabsTrigger value="/history" className="h-10 rounded-lg px-3 text-xs font-medium text-slate-300 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                  History
                </TabsTrigger>
                <TabsTrigger value="/notifications" className="h-10 rounded-lg px-3 text-xs font-medium text-slate-300 data-[state=active]:bg-white/10 data-[state=active]:text-white">
                  Settings
                </TabsTrigger>
              </TabsList>
            </div>

            <div className="ml-auto flex items-center gap-2 md:order-3">
              <div className={`hidden items-center gap-2 rounded-full border px-3 py-2 text-[11px] font-medium lg:flex ${connection.tone}`} title="Based on the backend system status poll">
                <span className={`size-2 rounded-full ${connection.dot} ${connection.pulse ? 'motion-safe:animate-pulse' : ''}`} aria-hidden="true" />
                <span>{connection.label}</span>
              </div>
              <AlarmSound />
              <PwaControls />
              <UserMenu />
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-white/5 px-4 py-2 text-[11px] font-medium lg:hidden">
            <Activity className="size-3.5 text-cyan-200" aria-hidden="true" />
            <span className="text-slate-300">{connection.label}</span>
            {status.error && <CircleAlert className="size-3.5 text-amber-300" aria-label="Status poll error" />}
          </div>
        </header>
        <TabsContent value={activeTab} className="m-0 outline-none">
          <AppRoutes token={token} />
        </TabsContent>
    </Tabs>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider><Shell /></AuthProvider>
    </BrowserRouter>
  );
}
