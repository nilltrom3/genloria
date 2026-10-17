// service-worker.js — PWA: app shell offline, API siempre a la red.
const CACHE = 'genloria-v4';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/tree.js', '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/avatar-default.svg'
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

  // App shell: caché primero, red como respaldo
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(request, copy));
      return res;
    }).catch(() => caches.match('/index.html')))
  );
});
