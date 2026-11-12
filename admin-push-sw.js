self.addEventListener('push', event => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: 'Repute Tech alert', body: 'An important platform update needs your attention.' };
  }
  const title = String(payload.title || 'Repute Tech alert');
  const severity = ['HIGH', 'MEDIUM', 'INFO'].includes(String(payload.severity || '').toUpperCase())
    ? String(payload.severity).toUpperCase() : 'INFO';
  const category = String(payload.category || 'PLATFORM').replace(/[^a-z0-9 _-]/gi, '').slice(0, 32);
  const options = {
    body: String(payload.body || 'An important platform update needs your attention.'),
    tag: String(payload.tag || 'repute-tech-alert'),
    renotify: true,
    timestamp: Number.isFinite(Number(payload.timestamp)) ? Number(payload.timestamp) : Date.now(),
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    dir: 'auto',
    lang: 'en-IN',
    vibrate: severity === 'HIGH' ? [180, 90, 180, 90, 260] : [120, 70, 120],
    requireInteraction: severity === 'HIGH',
    data: {
      url: String(payload.url || '/admin-panel'),
      category,
      severity
    },
    actions: [
      { action: 'open', title: 'View alert' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
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
