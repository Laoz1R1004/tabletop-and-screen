// Bump this version when changing the offline app shell. Never cache collection data.
const CACHE = 'tabletop-screen-shell-v2';
const FILES = [
  'index.html', 'tabletop.html', 'screen.html', 'css/styles.css',
  'js/domain.js', 'js/screen-domain.js', 'js/storage.js', 'js/tabletop.js',
  'js/screen.js', 'js/card-size.js', 'js/pwa.js', 'manifest.webmanifest',
  'assets/brand-mark.svg', 'assets/favicon.svg', 'assets/FZZhuoYTJW_Te.TTF',
  'assets/app-icon-192.png', 'assets/app-icon-512.png'
];
const urls = new Set(FILES.map(file => new URL(file, self.registration.scope).href));
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(
    [...urls].map(url => new Request(url, {cache: 'reload'}))
  )));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith('tabletop-screen-shell-') && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  url.search = '';
  if (url.href === self.registration.scope) url.pathname += 'index.html';
  if (!urls.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request, {cache: 'no-cache'});
      if (response.ok) {
        event.waitUntil(cache.put(url.href, response.clone()));
        return response;
      }
      return (await cache.match(url.href)) || response;
    } catch {
      return (await cache.match(url.href)) || Response.error();
    }
  })());
});
