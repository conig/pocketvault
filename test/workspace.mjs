import {chromium} from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--class=codex-smoke-test']});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true});const page=await context.newPage();
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const body='# Field notes\n\nTags: #project\n\n## A quieter workspace\n\nKeep **what matters**, leave the rest.\n\n- [ ] One useful thing\n- [x] No unnecessary chrome\n\n[Reference](https://example.com/a-long-url) and [[Other|another note]].\n\n```js\nconst link = "[[not a link]]";\n```\n\n<script>alert(1)</script>\n';
const docs=[{path:'work/Field notes.md',sha:'a',text:body},{path:'work/Other.md',sha:'b',text:'# Other\n\nA second note.'}];
await context.route('https://api.github.com/**',route=>{const url=route.request().url();const value=url.includes('/commits?')?[{sha:'commit',commit:{tree:{sha:'tree'}}}]:url.includes('/git/trees/')?{tree:docs.map(d=>({path:d.path,sha:d.sha,type:'blob',mode:'100644',size:d.text.length}))}:{encoding:'base64',content:Buffer.from(docs.find(d=>url.endsWith('/'+d.sha)).text).toString('base64')};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});});
try{
 await page.goto('http://127.0.0.1:4173');await page.locator('#token-input').waitFor({state:'visible'});await page.locator('#manual-connection').evaluate(node => node.open = true);
 assert.equal(await page.locator('.workspace').isVisible(),false);assert.equal(await page.locator('.topbar').isVisible(),false);
 await page.screenshot({path:'/tmp/pocket-setup.png'});
 await page.locator('#manual-connection').evaluate(node => node.open = true);await page.locator('#repo-input').fill('fixture/notes');await page.locator('#token-input').fill('fake-token');await page.locator('#remember-token').check();await page.locator('#connect-submit').click();await page.locator('.note-row').first().waitFor();
 assert.equal(await page.locator('#connection-dialog').isVisible(),false);assert.equal(await page.locator('.welcome').count(),0);
 await page.screenshot({path:'/tmp/pocket-library.png'});
 await page.locator('#search').fill('second');assert.equal(await page.locator('.note-row').count(),1);await page.locator('#search').fill('');
 await page.locator('.filter-menu>summary').click();await page.locator('#tag-filter').selectOption('project');assert.equal(await page.locator('.note-row').count(),1);await page.locator('#tag-filter').selectOption('');await page.locator('.filter-menu>summary').click();
 await page.locator('#settings').click();assert.equal(await page.locator('#vault-options input').count(),4);await page.locator('#close-settings').click();
 await page.locator('.note-row').filter({hasText:'Field notes'}).click();await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();
 const text=await page.locator('.source-view').innerText();assert.ok(text.includes('# Field notes'));assert.ok(text.includes('**what matters**'));assert.ok(text.includes('- [ ]'));assert.ok(text.includes('```js'));assert.ok(text.includes('[[not a link]]'));assert.ok(text.includes('<script>alert(1)</script>'));assert.ok(!text.includes('https://example.com'));assert.ok(!text.includes('[[Other|'));
 assert.equal(await page.locator('.source-view script').count(),0);assert.equal(await page.locator('.source-view a[data-path]').count(),1);assert.equal(await page.locator('.source-view .syntax-heading').count(),2);
 assert.ok(await page.locator('a[href="https://example.com/a-long-url"]').isVisible());
 await page.screenshot({path:'/tmp/pocket-reader.png'});
 await page.locator('a[data-path]').click();await page.waitForFunction(()=>document.querySelector('.source-view')?.textContent.includes('A second note.'));
 await page.setViewportSize({width:1440,height:960});await page.locator('.note-row').filter({hasText:'Field notes'}).click();await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();await page.screenshot({path:'/tmp/pocket-desktop.png'});
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await context.setOffline(true);await page.reload();await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();
 assert.ok((await page.locator('.source-view').innerText()).includes('**what matters**'));assert.deepEqual(errors,[]);
 console.log('PASS setup isolation, connected workspace, source markers, concealed links, literal code/HTML, Tree-sitter, internal navigation, offline reload, phone/desktop.');
}finally{await browser.close();}
