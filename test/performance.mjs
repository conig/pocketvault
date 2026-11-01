// Populated local library must open from its installed cache even when the
// hosting/sign-in navigation is slow. Real HTTP, real worker, real IndexedDB.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
let slow = false;
const root=resolve('dist');
const server=createServer(async(req,res)=>{
 const p=new URL(req.url,'http://localhost').pathname;
 const file=resolve(root,'.'+(p==='/'?'/index.html':p));
 if(!file.startsWith(root+'/')){res.writeHead(404);res.end();return;}
 try{const body=await readFile(file);if(slow&&(p==='/'||p==='/index.html'))await new Promise(r=>setTimeout(r,1800));res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});res.end(body);}catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--class=codex-smoke-test']});
try{
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true});const page=await context.newPage();
 await page.goto(origin);await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await page.evaluate(async()=>{
  const notes=Array.from({length:532},(_,i)=>{const title=`Reference ${String(i).padStart(4,'0')}`;const body=`# ${title}\n\n`+'A useful reference about local notes and reading. '.repeat(115);return{path:`work/${1700000000+i}-reference.md`,sha:'sha'+i,vault:'work',title,body,tags:['reference'],plain:body,search:(title+' '+body).toLowerCase()};});
  const db=await new Promise(r=>{const x=indexedDB.open('pocket-vault');x.onsuccess=()=>r(x.result);});
  await new Promise((r,j)=>{const tx=db.transaction('data','readwrite'),s=tx.objectStore('data');s.put({repo:'fixture/notes',branch:'',commit:'seed',checkedAt:Date.now(),notes,files:notes.map(n=>({path:n.path,sha:n.sha}))},'snapshot');s.put({repo:'fixture/notes',branch:'',authRequired:true},'config');tx.oncomplete=r;tx.onerror=j;});
 });
 const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 slow=true;const start=Date.now();await page.reload({waitUntil:'domcontentloaded'});await page.locator('.note-row').first().waitFor();const startupMs=Date.now()-start;
 const searchStart=Date.now();await page.locator('#search').fill('Reference 0531');await page.waitForFunction(()=>document.querySelectorAll('.note-row').length===1);const searchMs=Date.now()-searchStart;
 console.log(JSON.stringify({fixtureNotes:532,fixtureBodyBytes:Math.round(532*115*46),cpuSlowdown:4,hostingNavigationDelayMs:1800,startupMs,searchMs}));
 assert.ok(startupMs<1300,`Cached populated startup took ${startupMs} ms; must not wait for the slow hosting navigation.`);
 assert.ok(searchMs<600,`Search interaction blocked for ${searchMs} ms.`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
