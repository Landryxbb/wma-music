/* WMA MUSIC — service worker minimal.
   Il permet d'installer l'application ; il ne met rien en cache :
   chaque page et chaque mise à jour viennent toujours directement du site. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  if (e.request.mode !== 'navigate') { e.respondWith(fetch(e.request)); return; }
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WMA MUSIC</title>' +
    '<body style="margin:0;background:#000;color:#fff;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px">' +
    '<div><p style="color:#FF7A1A;font-weight:800;font-size:22px">WMA MUSIC</p><p>No internet connection.<br>Check your connection and try again.</p></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
