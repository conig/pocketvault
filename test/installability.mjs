// Reproduce a signed-in browser fetching this app's manifest behind an HTTP
// cookie gate. A signed-in page alone does not authenticate manifest requests.
// Inspect Chrome's actual manifest parser/installability errors, not link markup.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve('dist');
const requests = [];
const mime = { '.html':'text/html', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml' };
const server = createServer(async (req,res) => {
 const path = new URL(req.url,'http://localhost').pathname;
 const signedIn = /(?:^|;\s*)test_session=signed-in(?:;|$)/.test(req.headers.cookie || '');
 requests.push({path,signedIn});
 if(!signedIn) {res.writeHead(401,{'content-type':'text/plain'});res.end('Sign in required');return;}
 const file=resolve(root,'.'+(path==='/'?'/index.html':path));
 if(!file.startsWith(root+'/')) {res.writeHead(404);res.end();return;}
 try {const body=await readFile(file);res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'});res.end(body);}
 catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port, origin=`http://127.0.0.1:${port}`;
const profile = await mkdtemp(join(tmpdir(),'pocket-vault-install-'));
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,serviceWorkers:'block',args:['--no-sandbox','--disable-dev-shm-usage','--class=codex-smoke-test']});
try {
 // Isolate the browser's initial installation check from the offline cache;
 // otherwise the worker can mask a manifest credentials bug after a reload.
 await context.addCookies([{name:'test_session',value:'signed-in',url:origin,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();
 await page.goto(origin,{waitUntil:'networkidle'});
 const cdp=await context.newCDPSession(page);
 const manifest=await cdp.send('Page.getAppManifest');
 const checks=await cdp.send('Page.getInstallabilityErrors');
 const report={manifestErrors:manifest.errors,hasManifest:!!manifest.data,installabilityErrors:checks.installabilityErrors,manifestRequests:requests.filter(r=>r.path==='/manifest.webmanifest')};
 console.log(JSON.stringify(report,null,2));
 assert.ok(manifest.data,'A signed-in visitor must receive an actual manifest, not an unauthenticated error.');
 assert.equal(manifest.errors.filter(e=>e.critical).length,0,'Chrome must parse the protected manifest without critical errors.');
 assert.deepEqual(checks.installabilityErrors,[],'Chrome must report no installability errors for a signed-in normal-profile visitor.');
 const parsed=JSON.parse(manifest.data);
 for(const icon of parsed.icons) {const response=await context.request.get(origin+icon.src);assert.equal(response.status(),200);assert.match(response.headers()['content-type'],/image\/png/);}
 console.log('PASS: signed-in Chrome can obtain and parse the protected install manifest and icons.');
} finally {await context.close();await new Promise(resolve=>server.close(resolve));await rm(profile,{recursive:true,force:true});}
