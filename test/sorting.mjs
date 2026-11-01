// Real app + GitHub-shaped fixtures, IndexedDB and offline service-worker reload.
// Opening a note must promote it without changing the note or losing that order.
import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve, extname} from 'node:path';

const root = resolve('dist');
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
  if (!file.startsWith(root + '/')) { res.writeHead(404); res.end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, {'content-type': ({'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.webmanifest':'application/manifest+json','.png':'image/png','.woff2':'font/woff2'})[extname(file)] || 'application/octet-stream'});
    res.end(body);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless:true, args:['--no-sandbox','--class=codex-smoke-test']});
try {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true});
  const page = await context.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const accessRecords = () => page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('pocket-vault'); req.onsuccess = () => resolve(req.result); req.onerror = reject;
    });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('data'), store = tx.objectStore('data');
        const keys = store.getAllKeys(), values = store.getAll();
        tx.oncomplete = () => resolve(keys.result.flatMap((key, i) => Array.isArray(key) && key[0] === 'access' ? [{key, ...values.result[i]}] : []));
        tx.onerror = reject;
      });
    } finally { db.close(); }
  });
  let revision = 1;
  const docs = [
    {path:'work/a.md', sha:'a', text:'---\ncreated: 2020-01-01\ntags: [reference]\n---\n# A old\n\nAn old reference. [[b|Newer note]]'},
    {path:'work/b.md', sha:'b', text:'---\ncreated: 2026-01-01\ntags: [reference]\n---\n# B created\n\nA reference.'},
    {path:'personal/z.md', sha:'z', text:'---\nmodified: 2026-02-01\ncreated: 2019-01-01\n---\n# Z modified\n\nA reference.'},
    {path:'work/c.md', sha:'c', text:'# C undated\n\nA reference.'}
  ];
  await context.route('https://api.github.com/**', route => {
    const url = route.request().url();
    const value = url.includes('/commits?') ? [{sha:'commit'+revision,commit:{tree:{sha:'tree'}}}] : url.includes('/git/trees/') ? {tree:docs.map(d => ({path:d.path,sha:d.sha,type:'blob',mode:'100644',size:d.text.length}))} : {encoding:'base64',content:Buffer.from(docs.find(d => url.endsWith('/'+d.sha)).text).toString('base64')};
    assert.equal(route.request().method(), 'GET');
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)});
  });
  const titles = () => page.locator('.note-row h2').allTextContents();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.locator('#manual-connection').evaluate(node => node.open = true);await page.locator('#repo-input').fill('fixture/notes');
  await page.locator('#token-input').fill('fake-token');
  await page.locator('#connect-submit').click();
  await page.locator('.note-row').first().waitFor();
  assert.deepEqual(await titles(), ['Z modified','B created','A old','C undated']);
  await page.locator('.note-row').filter({hasText:'A old'}).click();
  await page.locator('.source-view').waitFor();
  await page.getByRole('button', {name:'← Library',exact:true}).click();
  assert.deepEqual(await titles(), ['A old','Z modified','B created','C undated']);
  await page.locator('#search').fill('reference');
  // A/B also have a matching tag: relevance must still beat recency.
  assert.deepEqual(await titles(), ['A old','B created','Z modified','C undated']);
  await page.locator('#search').fill('');
  await page.locator('.note-row').filter({hasText:'A old'}).click();
  await page.locator('.source-view a[data-path]').click();
  await page.waitForFunction(() => document.querySelector('.reader-breadcrumb')?.textContent === 'B created');
  assert.deepEqual(await titles(), ['B created','A old','Z modified','C undated']);
  const beforeRefresh = await accessRecords();
  // A changed blob/snapshot must not discard separately stored access times.
  revision++; docs[0].sha = 'a2'; docs[0].text += '\nChanged upstream.';
  await page.locator('#settings').click();
  await page.locator('#connection-details > summary').click();
  await page.locator('#token-input').fill('fake-token');
  await page.locator('#connect-submit').click();
  await page.locator('#connection-dialog').waitFor({state:'hidden'});
  await page.getByRole('button', {name:'← Library',exact:true}).click();
  assert.deepEqual(await titles(), ['B created','A old','Z modified','C undated']);
  assert.deepEqual(await accessRecords(), beforeRefresh, 'refreshing an open note is not another access');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload(); await page.locator('.note-row').first().waitFor();
  assert.deepEqual(await titles(), ['B created','A old','Z modified','C undated']);
  // An offline open also persists, without a token or any repository writes.
  await page.locator('.note-row').filter({hasText:'C undated'}).click();
  await page.locator('.source-view').waitFor(); await page.getByRole('button', {name:'← Library',exact:true}).click();
  await page.reload(); await page.locator('.note-row').first().waitFor();
  assert.deepEqual(await titles(), ['C undated','B created','A old','Z modified']);
  await page.locator('.note-row').filter({hasText:'Z modified'}).click();
  await page.locator('.source-view').waitFor(); await page.getByRole('button', {name:'← Library',exact:true}).click();
  assert.equal((await accessRecords()).length, 4);
  // Excluding a vault must atomically purge its access-path metadata as well.
  await page.locator('#settings').click();
  await page.locator('#vault-options input[value="personal"]').uncheck();
  await page.locator('#save-vaults').click();
  await page.locator('#connection-dialog').waitFor({state:'hidden'});
  assert.equal((await accessRecords()).some(r => r.path.startsWith('personal/')), false);
  await page.reload(); await page.locator('.note-row').first().waitFor();
  assert.deepEqual(await titles(), ['C undated','B created','A old']);
  // The same paths in another repository must not inherit this source's reads.
  await context.setOffline(false);
  await page.locator('#settings').click();
  await page.locator('#connection-details > summary').click();
  await page.locator('#manual-connection').evaluate(node => node.open = true);await page.locator('#repo-input').fill('another/notes');
  await page.locator('#token-input').fill('fake-token');
  await page.locator('#connect-submit').click();
  await page.locator('#connection-dialog').waitFor({state:'hidden'});
  assert.deepEqual(await titles(), ['B created','A old','C undated']);
  assert.deepEqual(await accessRecords(), []);
  await page.locator('.note-row').filter({hasText:'C undated'}).click();
  await page.locator('.source-view').waitFor(); await page.getByRole('button', {name:'← Library',exact:true}).click();
  assert.equal((await accessRecords()).length, 1);
  await page.locator('#settings').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#forget').click();
  await page.waitForFunction(() => document.body.classList.contains('setup'));
  assert.deepEqual(await accessRecords(), []);
  assert.deepEqual(errors, []);
  console.log('PASS newest-first date fallbacks, access promotion, links, search relevance, refresh preservation, offline persistence, vault purge, source isolation and forget-device.');
} finally {
  await browser.close(); await new Promise(r => server.close(r));
}
