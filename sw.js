const V = 'bus-v13';
const SHELL = ['./', 'index.html', 'privacidad.html', 'app.js', 'style.css', 'manifest.json', 'lineas.json',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css', 'iconos/autobus_ida.png', 'iconos/autobus_vuelta.png', 'iconos/icon-192.png', 'iconos/lupa.png', 'iconos/parada_cercana.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(V).then(async c => {
  await c.addAll(SHELL);
  try { const ls = await (await fetch('lineas.json', { cache: 'no-store' })).json(); await c.addAll(ls.map(l => l.archivo)); } catch {}
}).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k)))).then(() => self.clients.claim())));
// Red primero (horarios siempre frescos); si no hay conexión, caché.
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {
    const cp = r.clone(); caches.open(V).then(c => c.put(e.request, cp)); return r;
  }).catch(() => caches.match(e.request)));
});
