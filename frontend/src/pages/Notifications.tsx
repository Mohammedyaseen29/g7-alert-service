import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';
import { Mail, Save, Settings2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.js';
import { Button } from '../components/ui/button.js';

function parseEmails(value: string): string[] {
  return value.split(/[\n,;]+/).map((email) => email.trim()).filter(Boolean);
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

  useEffect(() => {
    api.getNotificationConfig()
      .then((config) => { setValue(config.emails.join('\n')); setLoaded(true); })
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

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
          <p className="mt-2 text-sm text-slate-500">Choose who receives alarm and recovery messages.</p>
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

    </main>
  );
}
