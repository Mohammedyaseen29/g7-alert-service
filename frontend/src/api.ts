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
  setSensorStatus: (id: string, active: boolean) => req<{ sensorId: string; active: boolean }>(`/api/sensors/${id}/status`, { method: 'PUT', body: JSON.stringify({ active }) }),
  getConfig: (id: string) => req<Record<string, unknown>>(`/api/sensors/${id}/config`),
  putConfig: (id: string, body: unknown) => req(`/api/sensors/${id}/config`, { method: 'PUT', body: JSON.stringify(body) }),
  putSensorDefinition: (id: string, body: { name: string; secondaryRole: 'unclassified' | 'humidity' | 'temperature2' }) => req(`/api/sensors/${id}/definition`, { method: 'PUT', body: JSON.stringify(body) }),
  getNotificationConfig: () => req<import('./types.js').NotificationConfig>('/api/notifications/config'),
  putNotificationConfig: (emails: string[]) => req<import('./types.js').NotificationConfig>('/api/notifications/config', { method: 'PUT', body: JSON.stringify({ emails }) }),
  alarms: () => req<{ active: { id: string; sensorId: string; kind: string; message: string; startedAt: string }[]; history: unknown[] }>('/api/alarms'),
  status: () => req<Record<string, unknown>>('/api/system/status'),
  history: (id: string) => req<{ kind: string; value?: number; startedAt: string; recoveredAt?: string }[]>(`/api/sensors/${id}/history`),
  readingAvailability: (sensorIds: string[]) => req<{ first: string | null; last: string | null; archiveConfigured: boolean; hotDays: number; exportTtlDays: number }>(`/api/readings/availability?sensorIds=${encodeURIComponent(sensorIds.join(','))}`),
  readingExports: () => req<ReadingExport[]>('/api/readings/exports'),
  createReadingExport: (body: { sensorIds: string[]; from?: string; to?: string }) => req<ReadingExport>('/api/readings/exports', { method: 'POST', body: JSON.stringify(body) }),
  readingExportDownload: (id: string) => req<{ url: string }>(`/api/readings/exports/${id}/download`),
  pushConfig: () => req<{ enabled: boolean; publicKey: string }>('/api/push/config'),
  pushStatus: (endpoint: string) => req<{ subscribed: boolean; alarms: boolean; station: boolean }>(`/api/push/status?endpoint=${encodeURIComponent(endpoint)}`),
  savePushSubscription: (subscription: PushSubscriptionJSON & { alarms: boolean; station: boolean }) =>
    req<{ subscribed: boolean }>('/api/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription) }),
  removePushSubscription: (endpoint: string) => req<{ subscribed: boolean }>('/api/push/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  testPush: () => req<{ sent: boolean }>('/api/push/test', { method: 'POST' }),
};

export async function removePushOnLogout(token: string): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return;
  await fetch(`${BACKEND_URL}/api/push/subscriptions`, {
    method: 'DELETE', keepalive: true,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

export async function downloadAlarmHistory(): Promise<void> {
  const token = localStorage.getItem('g7_token');
  const response = await fetch(`${BACKEND_URL}/api/alarms/export.csv`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error('Could not download alarm history');
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'alarm-history.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

type CsvFileHandle = { createWritable: () => Promise<WritableStream<Uint8Array>> };
type CsvPickerWindow = Window & { showSaveFilePicker?: (options: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) => Promise<CsvFileHandle> };

export async function downloadReadingExport(job: ReadingExport): Promise<void> {
  const filename = `sensor-readings-${job.from.slice(0, 10)}-${job.to.slice(0, 10)}.csv`;
  const picker = (window as CsvPickerWindow).showSaveFilePicker;
  let fileHandle: CsvFileHandle | undefined;
  if (picker) {
    try { fileHandle = await picker.call(window, { suggestedName: filename, types: [{ description: 'CSV files', accept: { 'text/csv': ['.csv'] } }] }); }
    catch (error) { if (error instanceof DOMException && error.name === 'AbortError') return; throw error; }
  }
  const { url } = await api.readingExportDownload(job.id);
  if (url !== `/api/readings/exports/${job.id}/file`) throw new Error('Unexpected download location');
  const token = localStorage.getItem('g7_token');
  const response = await fetch(`${BACKEND_URL}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) throw new Error('Could not download sensor readings');
  if (fileHandle && response.body) {
    await response.body.pipeTo(await fileHandle.createWritable());
    return;
  }
  const blobUrl = URL.createObjectURL(await response.blob());
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
}

export interface ReadingExport {
  id: string;
  sensorIds: string[];
  from: string;
  to: string;
  status: 'PENDING' | 'PROCESSING' | 'DONE' | 'FAILED';
  rowCount: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
