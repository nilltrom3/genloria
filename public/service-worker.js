// service-worker.js — PWA: app shell con red primero (actualizaciones inmediatas), imágenes en caché.
const CACHE = 'genloria-v25';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/tree.js', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/avatar-default.svg',
  '/images/login-hero.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // API y subidas: red primero (contenido fresco), sin caché persistente
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')) {
    event.respondWith(fetch(request).catch(() => caches.match('/index.html')));
    return;
  }

  // Imágenes e iconos: caché primero (cambian poco)
  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/images/')) {
    event.respondWith(
      caches.match(request).then((hit) => hit || fetch(request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
        return res;
      }).catch(() => caches.match(request)))
    );
    return;
  }

  // App shell (HTML/JS/CSS): RED PRIMERO — siempre lo más nuevo cuando hay internet,
  // caché solo como respaldo sin conexión. Así las actualizaciones se ven al instante.
  event.respondWith(
    fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
      return res;
    }).catch(() => caches.match(request).then((hit) => hit || caches.match('/index.html')))
  );
});

// Notificaciones push
self.addEventListener('push', (event) => {
  let data = { title: 'GENLORIA', body: 'Tienes una novedad', url: '/#/feed' };
  try { if (event.data) data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/#/feed' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/#/feed';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(self.location.origin)) { w.focus(); w.navigate(url); return; }
      }
      clients.openWindow(url);
    })
  );
});
