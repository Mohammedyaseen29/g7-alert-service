/** Backend origin supplied at build time. */
export const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL ?? '').trim().replace(/\/$/, '');
function headers(): HeadersInit {
  const t = localStorage.getItem('g7_token');
  return { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) };
}
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BACKEND_URL}${path}`, { ...init, headers: { ...headers(), ...(init?.headers ?? {}) } });
  if (r.status === 401) {
    localStorage.removeItem('g7_token');
    if (location.pathname !== '/login') location.href = '/login';
    throw new Error('unauthorized');
  }
  if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error ?? `HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
export const api = {
  login: (username: string, password: string) =>
    req<{ access: string; user: { username: string; role: string } }>('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  sensors: () => req<import('./types.js').Sensor[]>('/api/sensors'),
  sensor: (id: string) => req<import('./types.js').Sensor & { activeAlarms: unknown[] }>('/api/sensors/' + id),
  getConfig: (id: string) => req<Record<string, unknown>>(`/api/sensors/${id}/config`),
  putConfig: (id: string, body: unknown) => req(`/api/sensors/${id}/config`, { method: 'PUT', body: JSON.stringify(body) }),
  putSensorDefinition: (id: string, body: { name: string; secondaryRole: 'unclassified' | 'humidity' | 'temperature2' }) => req(`/api/sensors/${id}/definition`, { method: 'PUT', body: JSON.stringify(body) }),
  getNotificationConfig: () => req<import('./types.js').NotificationConfig>('/api/notifications/config'),
  putNotificationConfig: (emails: string[]) => req<import('./types.js').NotificationConfig>('/api/notifications/config', { method: 'PUT', body: JSON.stringify({ emails }) }),
  alarms: () => req<{ active: { id: string; sensorId: string; kind: string; message: string; startedAt: string }[]; history: unknown[] }>('/api/alarms'),
  status: () => req<Record<string, unknown>>('/api/system/status'),
  history: (id: string) => req<{ kind: string; value?: number; startedAt: string; recoveredAt?: string }[]>(`/api/sensors/${id}/history`),
};
