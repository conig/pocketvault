const CACHE = 'pocket-vault-shell-v1';
const SHELL = __SHELL__;
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => {
    // Keep one prior immutable chunk set for still-open tabs from that build.
    const older = keys.filter(key => key.startsWith('pocket-vault-shell-') && key !== CACHE);
    return Promise.all(older.slice(0,-1).map(key => caches.delete(key)));
  }).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Credentials and GitHub responses never enter the service-worker cache.
  if (url.origin !== self.location.origin || event.request.method !== 'GET') return;
  if (event.request.mode === 'navigate') {
    // A populated installed reader is local-first. Hosting/auth latency must
    // not block opening already downloaded notes. Worker updates fetch a new
    // atomic shell independently; the online gate is not an offline vault lock.
    event.respondWith(caches.open(CACHE).then(cache => cache.match('/index.html')).then(cached => cached || fetch(event.request)));
  } else if (SHELL.includes(url.pathname) || url.pathname.startsWith('/chunks/')) {
    event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(cached => cached || caches.match(url.pathname)).then(cached => cached || fetch(event.request)));
  }
});
