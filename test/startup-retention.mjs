// A failed GitHub request after an installed/cached launch must never hide or
// delete the previous library, including a stale restored note URL.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--class=codex-smoke-test']});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true}),page=await context.newPage();
let fail=false,failures=0;
const docs=[{path:'work/Reference.md',sha:'a',text:'# Reference\n\nSaved offline reference.'},{path:'cooking/Recipe.md',sha:'b',text:'# Recipe\n\nSaved dinner notes.'}];
await context.route('https://api.github.com/**',route=>{
 if(fail){failures++;return route.abort('failed');}
 const url=route.request().url();const value=url.includes('/commits?')?[{sha:'commit',commit:{tree:{sha:'tree'}}}]:url.includes('/git/trees/')?{tree:docs.map(d=>({path:d.path,sha:d.sha,type:'blob',mode:'100644',size:d.text.length}))}:{encoding:'base64',content:Buffer.from(docs.find(d=>url.endsWith('/'+d.sha)).text).toString('base64')};
 return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
});
async function countStored(){return page.evaluate(async()=>{const db=await new Promise(r=>{const q=indexedDB.open('pocket-vault');q.onsuccess=()=>r(q.result);});return new Promise(r=>{const q=db.transaction('data').objectStore('data').get('snapshot');q.onsuccess=()=>r(q.result?.notes.length);});});}
try{
 await page.goto('http://127.0.0.1:4173');await page.locator('#token-input').waitFor({state:'visible'});await page.locator('#manual-connection').evaluate(node => node.open = true);await page.locator('#manual-connection').evaluate(node => node.open = true);await page.locator('#repo-input').fill('fixture/notes');await page.locator('#token-input').fill('fake-token');await page.locator('#remember-token').check();await page.locator('#connect-submit').click();await page.waitForFunction(()=>document.querySelectorAll('.note-row').length===2);
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 fail=true;await page.reload();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Could not reach GitHub'));
 assert.equal(await countStored(),2);assert.equal(await page.locator('.note-row').count(),2);
 console.log('PASS failed-GitHub cold launch retains displayed and stored notes.');
 await page.goto('http://127.0.0.1:4173/#note=work%2FMoved-note.md');await page.reload();await page.waitForFunction(()=>document.querySelector('#notice').textContent.includes('Could not reach GitHub'));
 assert.equal(await countStored(),2);
 assert.equal(await page.locator('.note-row').count(),2,'A stale restored URL must still show the saved library, not an empty app.');
 console.log('PASS stale restored note URL plus failed GitHub still exposes the cached library.');
 await page.getByRole('button',{name:'Connection and device settings'}).click();
 await page.getByText('Device cache & connection',{exact:true}).click();
 await page.locator('#diagnose-device').click();await page.waitForFunction(()=>!document.querySelector('#diagnose-device').disabled);
 const diagnostics=await page.locator('#device-diagnostics').innerText();
 assert.ok(diagnostics.includes('Saved notes: 2'));assert.ok(diagnostics.includes('Remembered token: yes'));assert.ok(diagnostics.includes('GitHub public connection: failed'));assert.ok(!diagnostics.includes('fake-token'));
 assert.equal(await countStored(),2);
 await page.locator('#connection-details').evaluate(n=>n.open=true);await page.locator('#connect-submit').click();await page.waitForFunction(()=>!document.querySelector('#connect-submit').disabled);
 assert.equal(await countStored(),2);await page.locator('#close-settings').click();assert.equal(await page.locator('.note-row').count(),2);
 console.log('PASS diagnostics report saved counts without secrets, and failed reconnection does not replace the cache.');
}finally{await browser.close();}
