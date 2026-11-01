// Exercise Settings against a real rendered app, with synthetic GitHub data.
// Selection is a device download boundary, not just a visual search filter.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--class=codex-smoke-test'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await context.newPage();
const checks = [], errors = [], calls = [];
const check = (condition, name) => { assert.ok(condition, name); checks.push(name); };
page.on('pageerror', e => errors.push(e.message));
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZqkAAAAASUVORK5CYII=';
const docs = [
 { path: 'work/Project.md', sha: 'work', text: '# Project\n\nWork-only reference.\n\n![Work diagram](work.png)' },
 { path: 'cooking/Recipe.md', sha: 'recipe', text: '# Recipe\n\nLemon pasta.\n\n![Cooking diagram](cooking.png)' },
 { path: 'cooking/Other.md', sha: 'other', text: '# Other\n\nA kitchen note.' },
 { path: 'codex/Setup.md', sha: 'setup', text: '# Setup\n\nA system reference.' }
];
let failCodex = false;
await context.route('https://api.github.com/**', async route => {
 const url = route.request().url(); calls.push(url); let data;
 if (url.includes('/commits?')) data = [{ sha: 'same-commit', commit: { tree: { sha: 'tree' } } }];
 else if (url.includes('/git/trees/')) data = { tree: [...docs.map(d => ({ path: d.path, sha: d.sha, type: 'blob', mode: '100644', size: d.text.length })), ...['work', 'cooking'].map(v => ({ path: `${v}/${v}.png`, sha: v + '-image', type: 'blob', mode: '100644', size: 68 }))] };
 else if (url.endsWith('/setup') && failCodex) return route.fulfill({ status: 403, contentType: 'application/json', body: '{}' });
 else if (url.endsWith('-image')) data = { encoding: 'base64', content: image };
 else { const doc = docs.find(d => url.endsWith('/' + d.sha)); assert.ok(doc, url); data = { encoding: 'base64', content: Buffer.from(doc.text).toString('base64') }; }
 await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});
const settings = () => page.getByRole('button', { name: 'Connection and device settings' }).click();
const choice = value => page.locator(`#vault-options input[value="${value}"]`);
const save = async () => { await page.locator('#save-vaults').click(); await page.waitForFunction(() => !document.querySelector('#connection-dialog').open); };
async function saved() {
 return page.evaluate(async () => {
  const db = await new Promise(resolve => { const r = indexedDB.open('pocket-vault'); r.onsuccess = () => resolve(r.result); });
  const get = key => new Promise(resolve => { const r = db.transaction('data').objectStore('data').get(key); r.onsuccess = () => resolve(r.result); });
  const assets = await new Promise(resolve => { const r = db.transaction('assets').objectStore('assets').getAllKeys(); r.onsuccess = () => resolve(r.result); });
  return { config: await get('config'), snapshot: await get('snapshot'), assets };
 });
}
try {
 await page.goto('http://127.0.0.1:4173'); await page.locator('.mobile-connect [data-connect]').click();
 check(!await page.locator('#vault-settings').isVisible(), 'vault settings appear only after connection');
 await page.locator('#manual-connection').evaluate(node => node.open = true);await page.locator('#repo-input').fill('owner/notes'); await page.locator('#token-input').fill('test-token'); await page.locator('#connect-submit').click();
 await page.waitForFunction(() => document.querySelector('#result-count').textContent === '4 notes');
 // Cache an attachment from each vault so exclusion must physically remove it.
 for (const path of ['cooking/Recipe.md', 'work/Project.md']) {
   await page.locator(`.note-row[data-path="${path}"]`).click();
   await page.waitForFunction(() => [...document.querySelectorAll('.prose img')].some(i => i.complete && i.naturalWidth === 1));
   await page.getByRole('button', { name: '← Library' }).click();
 }
 await page.getByRole('button', { name: 'Work', exact: true }).click(); await page.locator('.note-row').click();
 await settings();
 check(await page.locator('#vault-settings').isVisible() && await page.locator('#vault-options input:checked').count() === 4, 'connected Settings exposes all four initially selected vaults');
 await page.screenshot({ path: '/tmp/pocket-vault-qa/vault-settings.png', fullPage: true, animations: 'disabled' });
 for (const v of ['work', 'personal', 'codex']) await choice(v).uncheck();
 await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
 await context.setOffline(true); const beforeRemove = calls.length; await save();
 check(calls.length === beforeRemove, 'removing vaults needs no network requests');
 check(await page.locator('.note-row').count() === 2 && !await page.locator('#filters').getByRole('button', { name: 'Work', exact: true }).count(), 'selection removes excluded filters and resets a removed active filter');
 check(!await page.locator('.workspace').evaluate(n => n.classList.contains('note-open')) && !new URL(page.url()).hash, 'removing the open note closes the reader and clears the route');
 const subset = await saved();
 check(JSON.stringify(subset.config.vaults) === JSON.stringify(['cooking']) && subset.snapshot.notes.every(n => n.vault === 'cooking') && subset.snapshot.files.every(f => f.path.startsWith('cooking/')), 'saved selection removes excluded note content and file names from IndexedDB');
 check(subset.assets.length === 1 && subset.assets[0].endsWith('cooking-image'), 'removing vaults purges only their cached attachments');
 await page.locator('#search').fill('Work-only'); check(await page.locator('.note-row').count() === 0, 'search cannot reveal excluded notes'); await page.locator('#search').fill('');
 await settings(); await choice('work').check(); await page.locator('#save-vaults').click();
 check(await page.locator('#connection-dialog').isVisible() && (await saved()).config.vaults.length === 1, 'offline expansion is refused without changing the saved selection');
 await page.locator('#close-settings').click(); await page.reload();
 await page.waitForFunction(() => document.querySelector('#result-count').textContent === '2 notes'); await settings();
 check(await choice('cooking').isChecked() && !await choice('work').isChecked(), 'selection persists after offline reload');
 await page.locator('#close-settings').click(); await context.setOffline(false); await settings(); await choice('work').check();
 const beforeMissingToken = calls.length; await page.locator('#save-vaults').click();
 check(await page.locator('#connection-details').evaluate(n => n.open) && calls.length === beforeMissingToken && await page.locator('#connection-error').isVisible(), 'adding uncached vaults requests missing GitHub access without silently changing authentication');
 await page.locator('#token-input').fill('test-token'); const beforeAdd = calls.length; await save();
 check(await page.locator('.note-row').count() === 3 && await page.locator('#filters').getByRole('button', { name: 'Work', exact: true }).count() === 1, 'adding a vault restores it to the library and navigation');
 const added = calls.slice(beforeAdd).filter(c => c.includes('/git/blobs/'));
 check(added.length === 1 && added[0].endsWith('/work'), 'same-commit expansion downloads only missing note content');
 await settings(); await choice('work').uncheck(); await page.locator('#close-settings').click(); await settings();
 check(await choice('work').isChecked(), 'closing Settings without saving discards checkbox edits');
 for (const v of ['work', 'personal', 'cooking', 'codex']) await choice(v).uncheck();
 await page.locator('#save-vaults').click();
 check(await page.locator('#connection-error').isVisible() && (await saved()).config.vaults.length === 2, 'at least one selected vault is required');
 await page.locator('#close-settings').click(); await settings(); await choice('codex').check(); failCodex = true;
 await page.locator('#save-vaults').click(); await page.waitForFunction(() => !document.querySelector('#save-vaults').disabled);
 check(await page.locator('#connection-dialog').isVisible() && !(await saved()).config.vaults.includes('codex') && (await saved()).snapshot.notes.length === 3, 'failed new-vault download preserves the complete previous selection and snapshot');
 check(errors.length === 0, 'vault selection has no browser runtime errors');
 console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} finally { await browser.close(); }
