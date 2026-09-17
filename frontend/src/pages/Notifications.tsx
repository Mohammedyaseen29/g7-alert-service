import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../auth.js';

function parseEmails(value: string): string[] {
  return value.split(/[\n,;]+/).map((email) => email.trim()).filter(Boolean);
}

export function Notifications() {
  const auth = useAuth();
  const [value, setValue] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const canEdit = auth.role === 'ADMIN' || auth.role === 'OPERATOR';

  useEffect(() => {
    api.getNotificationConfig()
      .then((config) => setValue(config.emails.join('\n')))
      .catch((err) => setError(String(err)));
  }, []);

  const save = async () => {
    setMessage('');
    setError('');
    try {
      const config = await api.putNotificationConfig(parseEmails(value));
      setValue(config.emails.join('\n'));
      setMessage(`${config.emails.length} notification recipient${config.emails.length === 1 ? '' : 's'} saved.`);
    } catch (err) {
      setError(String(err));
    }
  };

  return (
    <main className="settings-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Delivery settings</span>
          <h1>Email notifications</h1>
          <p>Alarm and recovery messages are sent to every address listed below.</p>
        </div>
        <span className="status-pill">Email delivery</span>
      </div>

      <section className="card settings-card">
        <label htmlFor="notification-emails">Recipient email addresses</label>
        <textarea
          id="notification-emails"
          rows={8}
          value={value}
          disabled={!canEdit}
          placeholder={'operations@example.com\nmanager@example.com'}
          onChange={(event) => setValue(event.target.value)}
        />
        <p className="field-help">Enter one address per line, or separate addresses with commas. Up to 25 recipients.</p>
        {!canEdit && <div className="notice warning">Your VIEWER role can see recipients but cannot change them.</div>}
        {error && <div className="notice error">{error}</div>}
        {message && <div className="notice success">{message}</div>}
        <button disabled={!canEdit} onClick={save}>Save recipients</button>
      </section>

    </main>
  );
}
