/* WMA MUSIC — service worker.
   - Permet d'installer l'application.
   - Garde une copie de l'application elle-même (page, réglages, icônes) pour qu'elle
     s'ouvre sans internet et que les membres Premium écoutent leurs téléchargements.
   - Toujours « le réseau d'abord » : quand il y a internet, chaque page et chaque mise à jour
     viennent directement du site ; la copie ne sert que hors connexion.
   - Les chansons téléchargées ne passent pas par ici : elles sont rangées par l'application. */
const SHELL = 'wma-shell-v3';
const CORE = ['/', '/config.js', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];
const LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => Promise.all([...CORE, LIB].map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('wma-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())));

const offlinePage = () => new Response(
  '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WMA MUSIC</title>' +
  '<body style="margin:0;background:#000;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">' +
  '<div><p style="color:#FF7A1A;font-weight:800;font-size:22px">WMA MUSIC</p><p>No internet connection.<br>Check your connection and try again.</p></div>',
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

async function networkFirst(req, key) {
  const c = await caches.open(SHELL);
  try {
    const r = await fetch(req);
    if (r && r.ok && r.type !== 'opaque') c.put(key || req, r.clone()).catch(() => {});
    return r;
  } catch (err) {
    const hit = await c.match(key || req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.href === LIB) { e.respondWith(caches.match(LIB).then(h => h || fetch(req))); return; }
  if (u.origin !== self.location.origin || u.pathname.startsWith('/api/') || u.pathname.startsWith('/s/') || u.pathname.startsWith('/l/')) return;
  if (req.mode === 'navigate') { e.respondWith(networkFirst(req, '/').catch(offlinePage)); return; }
  if (CORE.includes(u.pathname) || u.pathname.startsWith('/artists/')) { e.respondWith(networkFirst(req)); return; }
});

// ---------- Notifications sur le téléphone (nouvelles sorties) ----------
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  const opts = { body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag || 'wma', renotify: false,
    data: { url: d.url || '/' } };
  if (d.image) opts.image = d.image;
  e.waitUntil(self.registration.showNotification(d.title || 'WMA MUSIC', opts));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin && 'focus' in c) { await c.focus(); try { await c.navigate(url); } catch (err) { c.postMessage({ wmaOpen: url }); } return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
