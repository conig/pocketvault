// Real browser, IndexedDB, service worker and persisted browser profile.
// Synthetic notes only; no live GitHub credentials or user browser profile.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdtemp, mkdir, rm} from 'node:fs/promises';
import {resolve, extname} from 'node:path';
import {tmpdir} from 'node:os';
const catalog=JSON.parse(await readFile('src/themes/base46.json','utf8'));
const root=resolve('dist');
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  const file=resolve(root,'.'+(path==='/'?'/index.html':path));
  if(!file.startsWith(root+'/')) {res.writeHead(404);res.end();return;}
  try {
    const body=await readFile(file);
    res.writeHead(200,{'content-type':({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.wasm':'application/wasm'})[extname(file)]||'text/plain'});res.end(body);
  } catch {res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const profile=await mkdtemp(resolve(tmpdir(),'pocket-vault-themes-'));
const captures='/tmp/pocket-vault-theme-qa';await mkdir(captures,{recursive:true});
const launch=()=>chromium.launchPersistentContext(profile,{executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--class=codex-smoke-test'],viewport:{width:390,height:844},isMobile:true});
let context;
const errors=[];
const rgb=hex=>`rgb(${hex.slice(1).match(/../g).map(x=>parseInt(x,16)).join(', ')})`;
const themeState=page=>page.evaluate(()=>{
  const root=document.documentElement, style=getComputedStyle(root);
  const color=selector=>{const el=document.querySelector(selector);return el?getComputedStyle(el).color:null;};
  const bg=selector=>{const el=document.querySelector(selector);return el?getComputedStyle(el).backgroundColor:null;};
  return {id:root.dataset.theme,scheme:style.colorScheme,paper:style.getPropertyValue('--paper').trim(),background:bg('html'),chrome:bg('.topbar'),reader:bg('.reader'),heading:color('.source-view .syntax-heading'),link:color('.source-view a'),meta:document.querySelector('meta[name="theme-color"]').content,saved:localStorage.getItem('pocket-vault-theme')};
});
async function choose(page,id) {if(await page.locator('#theme-page').isHidden()) await page.locator('#open-themes').click();await page.locator(`[data-preview-theme="${id}"]`).click();}
async function leaveGallery(page) {if(await page.locator('#theme-page').isVisible()) await page.locator('#themes-back').click();}
const snapshot=page=>page.evaluate(async()=>{
  const db=await new Promise((r,j)=>{const q=indexedDB.open('pocket-vault');q.onsuccess=()=>r(q.result);q.onerror=j;});
  try{return await new Promise((r,j)=>{const q=db.transaction('data').objectStore('data').get('snapshot');q.onsuccess=()=>r(q.result);q.onerror=j;});}finally{db.close();}
});
try {
  context=await launch();
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const requests=[];
  context.on('request',r=>requests.push(r.url()));
  const docs=[{path:'work/Field guide.md',sha:'a',text:'# Field guide\n\nTags: #notes\n\n## Ideas worth keeping\n\nKeep **what matters**.\n\n- [x] Read anywhere\n- [ ] Make a little time\n\nFollow [[Other|another note]].\n\n```js\nconst useful = true;\n```'}, {path:'work/Other.md',sha:'b',text:'# Other\n\nA second reference.'}];
  await context.route('https://api.github.com/**',route=>{
    const url=route.request().url();
    const data=url.includes('/commits?')?[{sha:'fixture',commit:{tree:{sha:'tree'}}}]:url.includes('/git/trees/')?{tree:docs.map(d=>({path:d.path,sha:d.sha,type:'blob',mode:'100644',size:d.text.length}))}:{encoding:'base64',content:Buffer.from(docs.find(d=>url.endsWith('/'+d.sha)).text).toString('base64')};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(origin);await page.locator('#open-themes').waitFor();
  for(const colorScheme of ['light','dark']) {
    await page.emulateMedia({colorScheme});assert.equal((await themeState(page)).scheme,'dark');
  }
  const initialFrame=await page.locator('#connection-dialog').boundingBox();
  await page.locator('#token-input').fill('unsaved-test-token');
  await page.locator('#open-themes').click();
  assert.equal(await page.locator('.theme-preview').count(),Object.keys(catalog.themes).length);
  const galleryFrame=await page.locator('#connection-dialog').boundingBox();
  assert.equal(initialFrame.width,galleryFrame.width);assert.equal(initialFrame.height,galleryFrame.height);
  for(const [id,t] of Object.entries(catalog.themes)) {const colors=await page.locator(`[data-preview-theme="${id}"]`).evaluate(n=>({paper:getComputedStyle(n).getPropertyValue('--paper').trim(),ink:getComputedStyle(n.querySelector('h2')).color}));assert.equal(colors.paper,t.base_30.black);assert.equal(colors.ink,rgb(t.base_30.white));}
  await page.locator('#theme-search').fill('catppuccin');assert.ok(await page.locator('.theme-preview:visible').count()>=2);
  await page.locator('#theme-search').fill('not-a-theme');assert.equal(await page.locator('.theme-preview:visible').count(),0);assert.ok(await page.locator('#theme-empty').isVisible());
  await page.keyboard.press('Escape');assert.ok(await page.locator('#connection-form').isVisible());assert.equal(await page.locator('#token-input').inputValue(),'unsaved-test-token');assert.equal(await page.locator('#open-themes').evaluate(n=>n===document.activeElement),true);
  // Theme settings are usable before GitHub is connected, and survive reload.
  await choose(page,'catppuccin');
  assert.equal((await themeState(page)).saved,'catppuccin');
  await page.reload();await page.locator('#open-themes').waitFor();
  assert.equal(await page.locator('#theme-name').innerText(),'catppuccin');
  await page.locator('#manual-connection').evaluate(node => node.open = true);await page.locator('#repo-input').fill('fixture/notes');
  await page.locator('#token-input').fill('synthetic-token');
  await page.locator('#connect-submit').click();await page.locator('.note-row').first().waitFor();
  await page.locator('.note-row').filter({hasText:'Field guide'}).click();
  await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();
  const before=await snapshot(page), apiCalls=requests.filter(u=>u.includes('api.github.com')).length;
  await page.locator('#settings').click();
  for(const [id,theme] of Object.entries(catalog.themes)) {
    await choose(page,id);
    const state=await themeState(page);
    assert.equal(state.id,id);assert.equal(state.saved,id);assert.equal(state.scheme,theme.type,id);
    assert.equal(state.paper,theme.base_30.black,id);
    assert.equal(state.background,rgb(theme.base_30.black),id);
    assert.equal(state.chrome,rgb(theme.base_30.darker_black),id);
    assert.equal(state.reader,rgb(theme.base_30.black),id);
    assert.equal(state.heading,rgb(theme.base_16.base0D),id);
    assert.equal(state.link,rgb(theme.base_16.base0C),id);
    assert.equal(state.meta,theme.base_30.black,id);
  }
  assert.deepEqual(await snapshot(page),before,'Theme changes must not modify saved notes.');
  assert.equal(requests.filter(u=>u.includes('api.github.com')).length,apiCalls);
  assert.ok(requests.every(u=>u.startsWith(origin)||u.startsWith('https://api.github.com/')),'No external theme/font requests.');
  // A failed save must not claim persistence or leave a different preview active.
  await choose(page,'onedark');
  await page.evaluate(()=>{window.originalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='pocket-vault-theme')throw new DOMException('Denied','SecurityError');return window.originalSetItem.call(this,key,value);};});
  await choose(page,'one_light');
  assert.match(await page.locator('#theme-status').innerText(),/Could not save/);
  assert.equal((await themeState(page)).id,'onedark');assert.equal((await themeState(page)).saved,'onedark');
  assert.equal(await page.locator('[aria-pressed="true"].theme-preview').getAttribute('data-preview-theme'),'onedark');
  await page.evaluate(()=>Storage.prototype.setItem=window.originalSetItem);
  for(const id of ['onedark','catppuccin','gruvbox','one_light']) {
    await choose(page,id);
    await page.screenshot({path:`${captures}/${id}-settings.png`,animations:'disabled'});
    await leaveGallery(page);await page.locator('#close-settings').click();
    await page.screenshot({path:`${captures}/${id}-reader.png`,animations:'disabled'});
    await page.locator('#settings').click();
  }
  await page.setViewportSize({width:320,height:720});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('#open-themes').isVisible());
  await page.setViewportSize({width:1360,height:900});await leaveGallery(page);await page.locator('#close-settings').click();
  await page.screenshot({path:`${captures}/one_light-desktop.png`,animations:'disabled'});
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  // Reopen the actual browser profile, offline, not just a same-page preview.
  await context.close();context=await launch();await context.setOffline(true);
  const offline=await context.newPage();offline.on('pageerror',e=>errors.push(e.message));
  await offline.addInitScript(()=>{
    const observer=new MutationObserver(()=>{
      if(document.body&&!window.firstBodyTheme){window.firstBodyTheme=document.documentElement.dataset.theme;observer.disconnect();}
    });observer.observe(document,{childList:true,subtree:true});
  });
  await offline.goto(origin+'/#note=work%2FField%20guide.md');
  await offline.locator('[data-syntax-engine="tree-sitter"]').waitFor();
  assert.equal((await themeState(offline)).id,'one_light');
  assert.equal(await offline.evaluate(()=>window.firstBodyTheme),'one_light','Restore before body content paints.');
  assert.deepEqual(await snapshot(offline),before);
  await offline.locator('#settings').click();
  await choose(offline,'nord');
  await leaveGallery(offline);await offline.locator('#close-settings').click();await offline.reload();
  await offline.locator('[data-syntax-engine="tree-sitter"]').waitFor();
  assert.equal((await themeState(offline)).id,'nord');
  // Missing catalog IDs and inaccessible preference storage must boot safely.
  await offline.evaluate(()=>localStorage.setItem('pocket-vault-theme','removed-theme'));
  await offline.reload();await offline.locator('.source-view').waitFor();
  assert.equal((await themeState(offline)).id,'onedark');
  const blocked=await context.newPage();
  await blocked.addInitScript(()=>{Storage.prototype.getItem=()=>{throw new DOMException('Denied','SecurityError');};});
  await blocked.goto(origin);await blocked.locator('.note-row').first().waitFor();
  assert.equal(await blocked.evaluate(()=>document.documentElement.dataset.theme),'onedark');await blocked.close();
  await offline.locator('#settings').click();await choose(offline,'catppuccin');
  await leaveGallery(offline);await offline.evaluate(()=>localStorage.setItem('unrelated-setting','keep'));
  offline.once('dialog',d=>d.accept());await offline.locator('#forget').click();
  await offline.locator('#token-input').waitFor();
  assert.equal((await themeState(offline)).id,'onedark');assert.equal((await themeState(offline)).saved,null);
  assert.equal(await offline.evaluate(()=>localStorage.getItem('unrelated-setting')),'keep');
  assert.equal(await snapshot(offline),undefined);
  await offline.reload();await offline.locator('#token-input').waitFor();
  assert.equal((await themeState(offline)).id,'onedark');
  assert.deepEqual(errors,[]);
  console.log(`PASS all ${Object.keys(catalog.themes).length} palettes, default, setup/settings, real browser restart, offline reload/change, pre-paint restore, invalid ID, storage failures, note retention and forget-device reset. Captures: ${captures}`);
} finally {
  await context?.close();await new Promise(r=>server.close(r));await rm(profile,{recursive:true,force:true});
}
