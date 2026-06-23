// Service Worker — Moura RSVP (PWA).
// Estratégia:
//   • /api/*  → network-only. Nunca cacheia respostas autenticadas.
//   • assets  → stale-while-revalidate (CSS/JS/imagens carregam do cache e
//               atualizam em segundo plano).
//   • páginas → network-first; fallback para página offline quando sem rede.
const VERSION = 'moura-rsvp-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;
const OFFLINE_URL = '/offline.html';

const PRECACHE = [
  OFFLINE_URL,
  '/assets/css/styles.css',
  '/assets/js/api.js',
  '/assets/js/shell.js',
  '/assets/img/wordmark-dark.png',
  '/assets/img/wordmark-light.png',
  '/assets/img/logo-moura.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => Promise.allSettled(PRECACHE.map((u) => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isAsset(url) {
  return url.pathname.startsWith('/assets/') || url.pathname === '/manifest.webmanifest';
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Dados autenticados nunca passam pelo cache.
  if (url.pathname.startsWith('/api/')) return;

  // Assets: responde do cache e revalida em segundo plano.
  if (isAsset(url)) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(req);
        const network = fetch(req).then((resp) => {
          if (resp && resp.ok) cache.put(req, resp.clone());
          return resp;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // Navegações/páginas: rede primeiro; offline → página de fallback.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        return resp;
      }).catch(async () => (await caches.match(req)) || caches.match(OFFLINE_URL))
    );
  }
});

// Push: notificação do servidor mesmo com o app fechado.
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : '' }; }
  const title = data.title || 'Moura RSVP';
  const options = {
    body: data.body || '',
    icon: '/assets/img/icon-192.png',
    badge: '/assets/img/icon-96.png',
    tag: data.tag || 'moura-rsvp',
    renotify: true,
    data: { url: data.url || '/admin/dashboard.html' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clique na notificação: foca uma aba já aberta ou abre uma nova.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin/dashboard.html';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) {
        try { await c.navigate(url); } catch (_) { /* navigate pode falhar */ }
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
