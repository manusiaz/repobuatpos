// BorNiz service worker: staff apps open and keep selling when the outlet's internet drops.
//   install   cache the key surfaces (and the pages open now) with the /_next/static files their HTML names
//   static    /_next/static and fonts: cache-first (file names are content-hashed)
//   pages     network-first; offline → this page, else a cached page of the same surface, else the POS
//   never     /api/*, Supabase and every other host pass straight through
const VERSION = 'bn-1';
const SHELL = ['/pos', '/kds', '/pic', '/waiter', '/display', '/owner', '/manager'];
const FONTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'api.fontshare.com', 'cdn.fontshare.com'];
const ANY = { ignoreSearch: true, ignoreVary: true };

/** 'static' | 'page' | null (not handled). */
function kind(url, mode, origin) {
  if (url.origin !== origin) return FONTS.includes(url.hostname) ? 'static' : null;
  if (url.pathname.startsWith('/api/')) return null;
  if (url.pathname.startsWith('/_next/static/')) return 'static';
  return mode === 'navigate' ? 'page' : null;
}
/** Offline fallback for a page that was never cached: the same surface (first path segment), then the POS, then home. */
function pick(path, cached) {
  for (const p of new Set(['/' + (path.split('/')[1] || ''), '/pos', '/'])) {
    const hit = cached.find(c => c === p) ?? (p === '/' ? undefined : cached.find(c => c.startsWith(p + '/')));
    if (hit) return hit;
  }
  return null;
}
const ok = r => r.ok && !r.redirected && r.type === 'basic';

async function precache() {
  const cache = await caches.open(VERSION);
  const open = (await self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
    .map(c => new URL(c.url)).filter(u => u.origin === self.location.origin).map(u => u.pathname);
  await Promise.allSettled([...new Set([...SHELL, ...open])].map(async p => {
    const res = await fetch(p, { credentials: 'same-origin' });
    if (!ok(res)) return;
    const assets = new Set((await res.clone().text()).match(/\/_next\/static\/[^"'\s\\)]+/g) ?? []);
    await cache.put(p, res);
    await Promise.allSettled([...assets].map(async a => (await cache.match(a, ANY)) || cache.add(a)));
  }));
}
async function cacheFirst(req) {
  const cache = await caches.open(VERSION), hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
  return res;
}
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    const res = await fetch(req);
    if (ok(res)) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req, ANY);
    if (hit) return hit;
    const p = pick(new URL(req.url).pathname, (await cache.keys()).map(r => new URL(r.url).pathname));
    return (p && await cache.match(p, ANY)) || Response.error();
  }
}

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(precache()); });
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// The page lists what it loaded before this worker controlled it (and the screens it warmed): keep the static ones.
self.addEventListener('message', e => {
  if (!Array.isArray(e.data?.cache)) return;
  const urls = e.data.cache.filter(u => kind(new URL(u), 'no-cors', self.location.origin) === 'static');
  e.waitUntil(caches.open(VERSION).then(c => Promise.allSettled(urls.map(async u => (await c.match(u, ANY)) || c.add(u)))));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const k = kind(new URL(e.request.url), e.request.mode, self.location.origin);
  if (k === 'static') e.respondWith(cacheFirst(e.request));
  else if (k === 'page') e.respondWith(networkFirst(e.request));
});
