self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Repute Tech alert', body: 'An important platform update needs your attention.' };
  }
  const title = String(payload.title || 'Repute Tech alert');
  const options = {
    body: String(payload.body || 'An important platform update needs your attention.'),
    tag: String(payload.tag || 'repute-tech-alert'),
    renotify: true,
    data: { url: String(payload.url || '/admin-panel') },
    icon: '/favicon.ico',
    badge: '/favicon.ico'
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    let target = '/admin-panel';
    try {
      const url = new URL(event.notification.data?.url || '/admin-panel', self.location.origin);
      if (url.origin === self.location.origin) target = url.pathname + url.search;
    } catch {}
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client) await client.navigate(target);
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(target);
  })());
});
