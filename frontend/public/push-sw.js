self.addEventListener('push', (event) => {
  let message;
  try { message = event.data ? event.data.json() : null; } catch { message = null; }
  const title = typeof message?.title === 'string' ? message.title : 'Pride Monitor alert';
  const body = typeof message?.body === 'string' ? message.body : 'Open Pride Monitor for details.';
  const url = message?.url === '/alarms' ? '/alarms' : '/';
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/temperature-192.png',
    badge: '/temperature-192.png',
    tag: typeof message?.tag === 'string' ? message.tag : 'pride-monitor',
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url === '/alarms' ? '/alarms' : '/', self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) { await existing.navigate(url); return existing.focus(); }
    return self.clients.openWindow(url);
  })());
});
