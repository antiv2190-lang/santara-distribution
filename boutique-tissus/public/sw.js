// Service worker : rend l'application installable et plus rapide sur connexion lente.
//  - fichiers de l'application (/static) : affichés tout de suite depuis le cache, mis à jour en arrière-plan ;
//  - pages : réseau d'abord, cache en secours (hors connexion) ;
//  - photos : cache d'abord ; liste publique des produits : réseau d'abord, cache en secours ;
//  - API du propriétaire (/api/admin, /api/super) : jamais mise en cache.
const V = 'tissus-v1';
const IMG = 'tissus-img-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (![V, IMG].includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => hit);
  return hit || net;
}
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try { const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r; }
  catch { return (await cache.match(req)) || new Response('Pas de connexion internet.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }); }
}
async function imageCache(req) {
  const cache = await caches.open(IMG);
  const hit = await cache.match(req);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok || r.type === 'opaque') {
    cache.put(req, r.clone());
    cache.keys().then((ks) => ks.length > 300 && cache.delete(ks[0])); // garde le cache léger
  }
  return r;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.pathname.startsWith('/api/admin') || url.pathname.startsWith('/api/super')) return;

  if (req.destination === 'image' || url.pathname.startsWith('/files/') || url.pathname.includes('/storage/v1/object/public/')) {
    e.respondWith(imageCache(req).catch(() => fetch(req))); return;
  }
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith('/static/')) { e.respondWith(staleWhileRevalidate(req, V)); return; }
  if (url.pathname.startsWith('/api/')) { e.respondWith(networkFirst(req, V)); return; }
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, V)); return; }
});
