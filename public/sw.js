// Service Worker — Moura RSVP (PWA).
// Estratégia:
//   • /api/*  → network-only. Nunca cacheia respostas autenticadas.
//   • assets  → stale-while-revalidate (CSS/JS/imagens carregam do cache e
//               atualizam em segundo plano).
//   • páginas → network-first; fallback para página offline quando sem rede.
const VERSION = 'moura-rsvp-v1';
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
