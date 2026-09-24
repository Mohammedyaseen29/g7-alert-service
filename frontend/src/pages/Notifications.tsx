import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Bell, Mail, Save, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { Button } from '../components/ui/button.js';

function parseEmails(value: string): string[] {
  return value.split(/[\n,;]+/).map((email) => email.trim()).filter(Boolean);
}

function within<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<T>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

export function Notifications() {
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const canEdit = auth.role === 'ADMIN' || auth.role === 'OPERATOR';
  const pushSupported = typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
  const [pushConfig, setPushConfig] = useState<{ enabled: boolean; publicKey: string } | null>(null);
  const [pushActive, setPushActive] = useState(false);
  const [pushAlarms, setPushAlarms] = useState(true);
  const [pushStation, setPushStation] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const [pushMessage, setPushMessage] = useState('');

  useEffect(() => {
    api.getNotificationConfig()
      .then((config) => { setValue(config.emails.join('\n')); setLoaded(true); })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let current = true;
    void api.pushConfig().then(async (config) => {
      if (!current) return;
      setPushConfig(config);
      if (!config.enabled || !pushSupported) return;
      const registration = await within(navigator.serviceWorker.ready, 10_000, 'The PWA service worker is not ready. Reload the page and try again.');
      const subscription = await registration.pushManager.getSubscription();
      if (!subscription || !current) return;
      const status = await api.pushStatus(subscription.endpoint);
      if (current) { setPushActive(status.subscribed); setPushAlarms(status.alarms); setPushStation(status.station); }
    }).catch(() => { if (current) setPushError('Could not check browser notification status.'); });
    return () => { current = false; };
  }, [pushSupported]);

  const enablePush = async () => {
    setPushBusy(true); setPushError(''); setPushMessage('');
    try {
      if (!pushConfig?.enabled || !pushSupported) throw new Error('Browser notifications are unavailable on this device.');
      const permission = await within(Notification.requestPermission(), 30_000, 'The browser did not respond to the notification request. Check its site permissions and try again.');
      if (permission !== 'granted') throw new Error('Allow notifications in your browser settings to enable alerts.');
      const registration = await within(navigator.serviceWorker.ready, 10_000, 'The PWA service worker is not ready. Reload the page and try again.');
      const subscription = await registration.pushManager.getSubscription()
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: pushConfig.publicKey });
      const details = subscription.toJSON();
      if (!details.endpoint || !details.keys?.p256dh || !details.keys.auth) throw new Error('Browser did not return a valid push subscription.');
      await api.savePushSubscription({ ...details, endpoint: details.endpoint, keys: details.keys, alarms: pushAlarms, station: pushStation });
      setPushActive(true);
      setPushMessage('Notifications enabled on this device.');
    } catch (cause) { setPushError(cause instanceof Error ? cause.message : 'Could not enable notifications.'); }
    finally { setPushBusy(false); }
  };

  const disablePush = async () => {
    setPushBusy(true); setPushError(''); setPushMessage('');
    try {
      const registration = await within(navigator.serviceWorker.ready, 10_000, 'The PWA service worker is not ready. Reload the page and try again.');
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) { await api.removePushSubscription(subscription.endpoint); await subscription.unsubscribe(); }
      setPushActive(false);
      setPushMessage('Notifications disabled on this device.');
    } catch (cause) { setPushError(cause instanceof Error ? cause.message : 'Could not disable notifications.'); }
    finally { setPushBusy(false); }
  };

  const savePushPreferences = async (alarms: boolean, station: boolean) => {
    setPushAlarms(alarms); setPushStation(station);
    if (!pushActive) return;
    setPushBusy(true); setPushError('');
    try {
      const registration = await within(navigator.serviceWorker.ready, 10_000, 'The PWA service worker is not ready. Reload the page and try again.');
      const subscription = await registration.pushManager.getSubscription();
      const details = subscription?.toJSON();
      if (!details?.endpoint || !details.keys?.p256dh || !details.keys.auth) throw new Error('Push subscription is missing. Enable notifications again.');
      await api.savePushSubscription({ ...details, endpoint: details.endpoint, keys: details.keys, alarms, station });
      setPushMessage('Notification choices saved.');
    } catch (cause) { setPushError(cause instanceof Error ? cause.message : 'Could not save notification choices.'); }
    finally { setPushBusy(false); }
  };

  const save = async () => {
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const config = await api.putNotificationConfig(parseEmails(value));
      setValue(config.emails.join('\n'));
      setMessage(`${config.emails.length} notification recipient${config.emails.length === 1 ? '' : 's'} saved.`);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8 sm:px-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-[.2em] text-teal-700">Workspace preferences</span>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Notification settings</h1>
          <p className="mt-2 text-sm text-slate-500">Set email recipients and enable alerts on this device.</p>
        </div>
        <Settings2 className="mt-2 size-6 text-slate-400" aria-hidden="true" />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-3 text-lg"><Mail className="size-5 text-teal-600" />Email recipients</CardTitle></CardHeader>
        <CardContent className="space-y-4">
        <label htmlFor="notification-emails" className="block text-sm font-medium">Recipient email addresses</label>
        <textarea
          id="notification-emails"
          rows={8}
          value={value}
          disabled={!canEdit || loading || saving || !loaded}
          className="min-h-48 w-full rounded-xl border border-slate-200 bg-slate-50/50 p-4 text-sm outline-none transition focus:border-teal-500 focus:ring-2 focus:ring-teal-500/15 disabled:opacity-60"
          placeholder={'operations@example.com\nmanager@example.com'}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="text-xs leading-relaxed text-slate-500">Enter one address per line, or separate addresses with commas. Up to 25 recipients.</p>
        {loading && <p role="status" className="text-sm text-slate-500">Loading recipients…</p>}
        {!canEdit && <div className="notice warning">Your VIEWER role can see recipients but cannot change them.</div>}
        {error && <div role="alert" className="notice error">{error}</div>}
        {message && <div role="status" className="notice success">{message}</div>}
        <Button disabled={!canEdit || loading || saving || !loaded} onClick={save} className="w-full sm:w-auto"><Save className="mr-2 size-4" />{saving ? 'Saving…' : 'Save recipients'}</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-3 text-lg"><Bell className="size-5 text-teal-600" />PWA notifications on this device</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-slate-600">Get an alert when a sensor alarm starts or recovers, or when the base station disconnects or stops reporting. Notifications can arrive while the PWA is closed.</p>
          {!pushSupported && <p role="status" className="text-amber-800">Install or open the PWA in a supported browser over HTTPS (localhost also works) to enable notifications.</p>}
          {pushConfig && !pushConfig.enabled && <p role="status" className="text-amber-800">Push delivery is not configured on the server yet.</p>}
          <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
            <label className="flex items-center gap-3"><input type="checkbox" checked={pushAlarms} disabled={pushBusy} onChange={(event) => { void savePushPreferences(event.target.checked, pushStation); }} className="size-4 accent-teal-700" />Sensor alarms and recoveries</label>
            <label className="flex items-center gap-3"><input type="checkbox" checked={pushStation} disabled={pushBusy} onChange={(event) => { void savePushPreferences(pushAlarms, event.target.checked); }} className="size-4 accent-teal-700" />Base station connection and reporting</label>
          </div>
          <div className="flex flex-wrap gap-2">
            {pushActive ? <Button type="button" variant="outline" disabled={pushBusy} onClick={() => { void disablePush(); }}>Disable on this device</Button>
              : <Button type="button" disabled={!pushSupported || !pushConfig?.enabled || pushBusy} onClick={() => { void enablePush(); }}>Enable on this device</Button>}
            {pushActive && <Button type="button" variant="outline" disabled={pushBusy} onClick={() => { setPushError(''); void api.testPush().then(() => setPushMessage('Test push requested. Check this device’s notifications.')).catch((cause) => setPushError(String(cause))); }}>Send test notification</Button>}
          </div>
          {pushError && <p role="alert" className="text-rose-700">{pushError}</p>}
          {pushMessage && <p role="status" className="text-teal-700">{pushMessage}</p>}
        </CardContent>
      </Card>

    </main>
  );
}
