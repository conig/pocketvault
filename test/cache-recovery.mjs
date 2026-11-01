// The real host may canonicalize /index.html to /. Cache.addAll follows that
// redirect. Replaying its redirected Response for a navigation can make Chrome
// fail with ERR_FAILED even though a fresh/incognito navigation works.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve('dist');
let legacy=false;
// Minimal deployed failure shape: a redirect-following precache replayed for
// navigation. This is intentionally only a historical test worker, not app code.
const legacyWorker = `const C='pocket-vault-shell-legacy';self.addEventListener('install',e=>{e.waitUntil(caches.open(C).then(c=>c.addAll(['/','/index.html','/app.js','/style.css'])));self.skipWaiting()});self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',e=>{if(e.request.mode==='navigate')e.respondWith(caches.open(C).then(c=>c.match('/index.html')))})`;

const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/index.html'||path==='/legacy-index'){res.writeHead(302,{location:'/'});res.end();return;}
 if(path==='/signin-with-chatgpt'){res.writeHead(200,{'content-type':'text/html'});res.end('<title>Sign in</title>Authentication route');return;}
 if(path==='/sw.js' && legacy){res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});res.end(legacyWorker);return;}
 const file=resolve(root,'.'+(path==='/'?'/index.html':path));
 if(!file.startsWith(root+'/')){res.writeHead(404);res.end();return;}
 try{const body=await readFile(file);res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--class=codex-smoke-test']});
try{
 const context=await browser.newContext(),page=await context.newPage();await page.goto(origin);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.evaluate(async()=>{
  const db=await new Promise(r=>{const q=indexedDB.open('pocket-vault');q.onsuccess=()=>r(q.result);});
  await new Promise((r,j)=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put({preserve:true},'recovery-sentinel');tx.oncomplete=r;tx.onerror=j;});
 });
 await page.evaluate(async()=>{const redirected=await fetch('/legacy-index');for(const key of await caches.keys())if(key.startsWith('pocket-vault-shell-')){await(await caches.open(key)).put('/index.html',redirected.clone());}});
 const cached=await page.evaluate(async()=>{for(const key of await caches.keys()){const r=await(await caches.open(key)).match('/index.html');if(r)return{redirected:r.redirected,url:r.url};}});
 console.log(JSON.stringify({cached}));
 await page.reload({waitUntil:'domcontentloaded'});
 assert.equal(await page.title(),'Pocket Vault','A previously cached, canonicalized shell must not cause ERR_FAILED.');
 const preserved=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('pocket-vault');q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=db.transaction('data').objectStore('data').get('recovery-sentinel');q.onsuccess=()=>r(q.result?.preserve);});});
 assert.equal(preserved,true,'Recovery must not erase local user data.');
 console.log('PASS cached redirected navigation reloads without ERR_FAILED and preserves IndexedDB.');
 await page.evaluate(async()=>{for(const key of await caches.keys())if(key.startsWith('pocket-vault-shell-')){const c=await caches.open(key);await c.delete('/');await c.delete('/index.html');}});
 await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});
 assert.equal(await page.title(),'Pocket Vault · Recovery','Missing shell plus offline must show recovery, not ERR_FAILED.');
 assert.ok((await page.locator('body').innerText()).includes('have not been erased'));
 await context.setOffline(false);await page.goto(origin+'/?recover=1');
 assert.equal(await page.title(),'Pocket Vault','Recovery must repair the shell automatically when online.');
 assert.equal(new URL(page.url()).searchParams.has('recover'),false,'Successful recovery must not leave every later launch in forced-network recovery mode.');
 await context.setOffline(true);await page.reload();assert.equal(await page.title(),'Pocket Vault','After repair the next launch must work offline.');await context.setOffline(false);
 const intact=await page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('pocket-vault');q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=db.transaction('data').objectStore('data').get('recovery-sentinel');q.onsuccess=()=>r(q.result?.preserve);});});assert.equal(intact,true);
 await page.goto(origin+'/signin-with-chatgpt');assert.equal(await page.title(),'Sign in','The worker must not swallow sign-in/callback navigation.');
 console.log('PASS missing-cache/offline recovery, online repair, authentication route passthrough, and preserved local data.');
 // Prove an already-broken normal profile can take the worker update merely
 // through navigation; no clearing storage or manual unregister is involved.
 legacy=true;const oldContext=await browser.newContext(),oldPage=await oldContext.newPage();
 await oldPage.goto(origin);await oldPage.evaluate(()=>navigator.serviceWorker.ready);await oldPage.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await oldPage.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('pocket-vault');q.onsuccess=()=>r(q.result);});await new Promise(r=>{const tx=db.transaction('data','readwrite');tx.objectStore('data').put('keep-me','upgrade-sentinel');tx.oncomplete=r;});});
 legacy=false;const update=oldContext.waitForEvent('serviceworker',{timeout:15000});
 await oldPage.reload({waitUntil:'domcontentloaded'}).catch(error=>{assert.match(error.message,/ERR_FAILED/);});
 const worker=await update;
 for(let i=0;i<100;i++){if(await worker.evaluate(()=>!self.registration.installing && self.registration.active?.state==='activated'))break;await new Promise(r=>setTimeout(r,100));}
 await oldPage.goto(origin);assert.equal(await oldPage.title(),'Pocket Vault');
 assert.equal(await oldPage.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('pocket-vault');q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=db.transaction('data').objectStore('data').get('upgrade-sentinel');q.onsuccess=()=>r(q.result);});}),'keep-me');
 console.log('PASS an already-broken installed worker updates on normal reload and repairs navigation without wiping user storage.');
 await oldContext.close();

}finally{await browser.close();await new Promise(r=>server.close(r));}
