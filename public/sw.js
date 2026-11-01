const CACHE = 'pocket-vault-shell-v1';
const SHELL = __SHELL__;
const shellPath = path => path === '/' || path === '/index.html';

// A cached redirect cannot be returned to a navigation with redirect:'manual'.
// Rebuild the response, not the user's storage, to remove its redirect history.
function navigationResponse(response) {
  return response.redirected ? new Response(response.body, {status:response.status,statusText:response.statusText,headers:response.headers}) : response;
}
async function validAsset(response, path) {
  if (!response?.ok) return false;
  const type = response.headers.get('content-type') || '';
  if (shellPath(path)) return type.includes('text/html') && await response.clone().text().then(html=>html.includes('<title>Pocket Vault</title>') && html.includes('id="connection-form"'));
  if (path.endsWith('.js')) return /javascript|ecmascript/.test(type);
  if (path.endsWith('.css')) return type.includes('text/css');
  if (path.endsWith('.webmanifest')) { try { return (await response.clone().json()).name === 'Pocket Vault'; } catch { return false; } }
  if (path.endsWith('.woff2')) { const b = new Uint8Array(await response.clone().arrayBuffer()); return b[0]===119 && b[1]===79 && b[2]===70 && b[3]===50; }
  return !type.includes('text/html');
}
async function download(cache, path) {
  const response = await fetch(shellPath(path) ? '/' : path, {credentials:'same-origin',cache:'reload'});
  if (!await validAsset(response,path)) throw new Error('Invalid app asset: ' + path);
  const safe = shellPath(path) ? navigationResponse(response) : response;
  await cache.put(path,safe.clone());
  return safe;
}
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    try {
      const cache = await caches.open(CACHE);
      // Fetch canonical HTML once; never cache a login page as the app shell.
      const html = await download(cache,'/'); await cache.put('/index.html',html.clone());
      const paths = SHELL.filter(path=>!shellPath(path)); let next=0;
      await Promise.all(Array.from({length:4},async()=>{while(next<paths.length) await download(cache,paths[next++]);}));
      await self.skipWaiting();
    } catch(error) {await caches.delete(CACHE);throw error;}
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => {
    const older = keys.filter(key=>key.startsWith('pocket-vault-shell-') && key!==CACHE);
    return Promise.all(older.slice(0,-1).map(key=>caches.delete(key)));
  }).then(()=>self.clients.claim()));
});
function recoveryPage() {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pocket Vault · Recovery</title><style>body{background:#0d1110;color:#e0e6df;font:15px/1.8 monospace;max-width:36em;margin:12vh auto;padding:24px}a{color:#b0d68d}</style><h1>Reconnecting the reader</h1><p>The app shell is unavailable. Your saved notes, token and vault choices have not been erased.</p><p>When you’re online, <a href="/?recover=1">repair the app shell and retry</a>.</p><p>No browser-data wipe or reinstall is needed.</p></html>`,{status:503,headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store'}});
}
async function navigation(request) {
  try {
    const cache = await caches.open(CACHE);
    if (!new URL(request.url).searchParams.has('recover')) {
      for (const path of ['/index.html','/']) {
        const cached = await cache.match(path);
        if (await validAsset(cached,path)) return navigationResponse(cached);
      }
    }
    // No usable shell: self-heal online, keeping all IndexedDB stores intact.
    const response = await download(cache,'/'); await cache.put('/index.html',response.clone());
    return response;
  } catch { return recoveryPage(); }
}
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin!==self.location.origin || event.request.method!=='GET') return;
  if (event.request.mode==='navigate') {
    // Authentication/callback routes must reach the host, not the cached app.
    if (shellPath(url.pathname)) event.respondWith(navigation(event.request));
  } else if (SHELL.includes(url.pathname) || url.pathname.startsWith('/chunks/')) {
    event.respondWith((async()=>{
      try {
        const cache = await caches.open(CACHE);
        const cached = await cache.match(url.pathname) || (url.pathname.startsWith('/chunks/') ? await caches.match(url.pathname) : null);
        if (await validAsset(cached,url.pathname)) return cached;
        return await download(cache,url.pathname);
      } catch { return new Response('App asset unavailable. Retry while online.',{status:503,headers:{'content-type':'text/plain'}}); }
    })());
  }
});
