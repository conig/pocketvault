import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {test, after} from 'node:test';

const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--class=codex-smoke-test']});
after(() => browser.close());
const body = '# Long note\n\n[[Missing note]] and [Missing file](missing.pdf)\n\n[[Other|Next note]] and [Reference](https://example.com)\n\n' + Array.from({length:120},(_,i)=>`Line ${i}: enough content to scroll the reader.`).join('\n') + '\n\n## Destination\n\nThe end.';
const docs = [{path:'work/Long note.md',sha:'long',text:body}, {path:'work/Other.md',sha:'other',text:'# Other\n\n[[Long note#Destination|Jump to destination]]'}, ...Array.from({length:40},(_,i)=>({path:`work/Short ${i}.md`,sha:`s${i}`,text:`# Short ${i}`}))];
async function connected() {
  const context = await browser.newContext({viewport:{width:1440,height:900}});
  await context.route('https://api.github.com/**',route=>{
    const url=route.request().url();
    const value=url.includes('/commits?')?[{sha:'commit',commit:{tree:{sha:'tree'}}}]:url.includes('/git/trees/')?{tree:docs.map(d=>({path:d.path,sha:d.sha,type:'blob',mode:'100644',size:d.text.length}))}:{encoding:'base64',content:Buffer.from(docs.find(d=>url.endsWith('/'+d.sha)).text).toString('base64')};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  const page=await context.newPage();
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#manual-connection').evaluate(n=>n.open=true);
  await page.locator('#repo-input').fill('fixture/notes');await page.locator('#token-input').fill('fake-token');await page.locator('#connect-submit').click();
  await page.locator('.note-row').first().waitFor();
  return {context,page};
}

test('desktop note selection transfers focus and keyboard scrolling from results to the reader', async()=>{
  const {context,page}=await connected();
  try {
    // Match desktop use: search, choose a result, then scroll without clicking the note again.
    await page.locator('#search').fill('note');
    await page.locator('#note-list .note-row[data-path="work/Long note.md"]').click();
    await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();
    const before=await page.evaluate(()=>({focus:document.activeElement.id,reader:document.querySelector('#reader').scrollTop,list:document.querySelector('#note-list').scrollTop}));
    await page.keyboard.press('PageDown');
    await page.waitForTimeout(350);
    const after=await page.evaluate(()=>({reader:document.querySelector('#reader').scrollTop,list:document.querySelector('#note-list').scrollTop}));
    console.log('Selection/scroll state', {before,after});
    assert.equal(before.focus,'reader');
    assert.ok(after.reader>before.reader,'PageDown must scroll the selected note');
    assert.equal(after.list,before.list,'result pane must not scroll');
    await page.keyboard.press('PageUp');await page.waitForTimeout(350);
    assert.ok(await page.locator('#reader').evaluate(n=>n.scrollTop)<after.reader);
    await page.getByRole('button',{name:'← Library',exact:true}).click();
    await page.locator('#search').fill('');
    await page.locator('#note-list .note-row[data-path="work/Long note.md"]').focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.activeElement.id==='reader');
    await page.getByRole('link',{name:'Next note',exact:true}).click();
    await page.getByRole('link',{name:'Jump to destination',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement.id==='reader' && document.querySelector('#reader').scrollTop>1000);
    assert.ok(await page.locator('[data-heading="Destination"]').isVisible());
    await page.getByRole('button',{name:'← Library',exact:true}).click();
    assert.equal(await page.locator('#search').evaluate(n=>n===document.activeElement),true);
  } finally {await context.close();}
});

test('desktop hint targets are real navigation, not unavailable links or source decoration', async()=>{
  const {context,page}=await connected();
  try {
    await page.locator('#note-list .note-row[data-path="work/Long note.md"]').click();
    await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();
    // qutebrowser's default hints.selectors.all includes ALL anchors, even without href.
    const phantoms=await page.locator('#reader a:not([href])').allTextContents();
    console.log('Non-actionable hint targets',phantoms);
    assert.deepEqual(phantoms,[],'unavailable references must not masquerade as links');
    assert.equal(await page.getByRole('link',{name:'Next note',exact:true}).count(),1);
    assert.equal(await page.getByRole('link',{name:'Reference',exact:true}).count(),1);
    assert.equal(await page.locator('.source-line [tabindex], .line-number[tabindex]').count(),0);
    const row=page.locator('#note-list .note-row').filter({hasText:'Other'});
    assert.equal(await row.getAttribute('href'),'#note=work%2FOther.md','note navigation should support native link hints/new tabs');
    assert.equal(await page.locator('.unresolved').count(),2);
    await page.getByRole('link',{name:'Next note',exact:true}).focus();await page.keyboard.press('Enter');
    await page.getByRole('link',{name:'Jump to destination',exact:true}).waitFor();
  } finally {await context.close();}
});

test('collapsed filter controls expose no layout boxes to qutebrowser hint discovery', async()=>{
  const {context,page}=await connected();
  try {
    // QtWebEngine hint discovery can see boxes inside native closed <details>
    // even when the controls are not painted. Do not offer phantom hints.
    const boxes=await page.locator('.filter-menu button, .filter-menu select').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));
    assert.ok(boxes.every(height=>height===0),`closed controls still have hint boxes: ${boxes}`);
    await page.locator('.filter-menu>summary').click();
    assert.ok(await page.getByRole('button',{name:'Work',exact:true}).isVisible());
    await page.getByRole('button',{name:'Work',exact:true}).click();
    await page.locator('.filter-menu>summary').click();
    assert.ok((await page.locator('.filter-menu button, .filter-menu select').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height))).every(height=>height===0));
  } finally {await context.close();}
});

test('reader exposes named landmarks/headings, native new-tab navigation and dialog focus return', async()=>{
  const {context,page}=await connected();
  try {
    const row=page.locator('#note-list .note-row[data-path="work/Long note.md"]');
    const popupPromise=context.waitForEvent('page');
    await row.click({modifiers:['Control']});
    const popup=await popupPromise;
    await popup.getByRole('region',{name:'Note reader: Long note',exact:true}).waitFor();
    await popup.close();
    await row.click();await page.waitForFunction(()=>document.activeElement.id==='reader');
    assert.equal(await page.title(),'Long note · Pocket Vault');
    assert.equal(await page.getByRole('navigation',{name:'Notes',exact:true}).count(),1);
    assert.equal(await page.locator('#reader').getByRole('heading',{level:1}).count(),1);
    assert.equal(await page.locator('#reader').getByRole('heading',{level:2}).count(),1);
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('.reader-nav .back-button').evaluate(n=>document.activeElement===n),true);
    await page.locator('#settings').click();
    await page.getByRole('dialog',{name:'Settings',exact:true}).waitFor();
    for (let i=0;i<5;i++) {
      await page.keyboard.press('Tab');
      assert.equal(await page.evaluate(()=>document.activeElement.closest('dialog')?.id),'connection-dialog','Tab must stay in the modal');
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#settings').evaluate(n=>document.activeElement===n),true);
    await page.locator('#note-list .note-row[data-path="work/Long note.md"]').click();
    await page.waitForFunction(()=>document.activeElement.id==='reader');
    await page.keyboard.press('/');
    assert.equal(await page.locator('#search').evaluate(n=>document.activeElement===n),true);
  } finally {await context.close();}
});

test('keyboard vault filtering retains focus on the chosen filter', async()=>{
  const {context,page}=await connected();
  try {
    await page.locator('.filter-menu>summary').click();
    const work=page.getByRole('button',{name:'Work',exact:true});
    await work.focus();await page.keyboard.press('Enter');
    assert.equal(await work.evaluate(n=>n===document.activeElement),true,'rebuilding filters must not discard keyboard focus');
    assert.equal(await work.getAttribute('aria-pressed'),'true');
  } finally {await context.close();}
});
