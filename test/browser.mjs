import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--class=codex-smoke-test'] });
const results = [];
const check = (condition, name) => { assert.ok(condition, name); results.push(name); };
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
const page = await context.newPage();
const errors = []; page.on('pageerror', e => errors.push(e.message));
const imageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZqkAAAAASUVORK5CYII=';
const requests = []; let fail = false, generation = 1;
const docs = [
  { path: 'cooking/Lemon pasta.md', text: '---\ntitle: Lemon pasta\ntags: [quick, dinner]\n---\n# Lemon pasta\n\nFresh lemon and herbs.\n\n## Method\n\n1. Boil pasta.\n2. Add lemon.\n\n[[Notes#Details|See details]]\n\n![[Notes#Details]]\n\n![external](https://tracking.invalid/pixel.png)\n\n<script>window.INJECTED = true</script>\n\n[javascript](javascript:alert(1))\n\n```text\n[[This is code, not a link]]\n```' },
  { path: 'cooking/Notes.md', text: '# Notes\n\nA kitchen note.\n\n## Details\n\nKeep some pasta water.\n\n![Diagram](diagram.png)\n\n## Other\n\nNot part of the embed.' },
  { path: 'work/Project.md', text: '# Project\n\nOffline planning reference.' }
];
await context.route('https://api.github.com/**', async route => {
  const req = route.request(); requests.push({ url: req.url(), method: req.method(), auth: req.headers().authorization });
  if (fail) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Forbidden' }) });
  const url = new URL(req.url()); let data;
  if (url.pathname.endsWith('/commits')) data = [{ sha: 'commit' + generation, commit: { tree: { sha: 'tree' + generation } } }];
  else if (url.pathname.includes('/git/trees/')) data = { tree: docs.slice(0, generation === 2 ? 2 : 3).map((d, i) => ({ path: d.path, sha: 'blob' + i, type: 'blob', mode: '100644', size: d.text.length })).concat([{ path: 'cooking/diagram.png', sha: 'image', type: 'blob', mode: '100644', size: 68 }]) };
  else if (url.pathname.endsWith('/git/blobs/image')) data = { encoding: 'base64', content: imageBase64 };
  else if (url.pathname.includes('/git/blobs/')) { const i = Number(url.pathname.split('blob').at(-1)); data = { encoding: 'base64', content: Buffer.from(docs[i].text).toString('base64') }; }
  else throw new Error('Unexpected API call: ' + url);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
});
try {
  await page.goto('http://127.0.0.1:4173');
  // The requested default stays dark even when Android/browser prefers light.
  for (const colorScheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme });
    const theme = await page.evaluate(() => ({ scheme: getComputedStyle(document.documentElement).colorScheme, background: getComputedStyle(document.body).backgroundColor }));
    check(theme.scheme === 'dark', `dark is the default with ${colorScheme} system preference`);
  }
  await page.locator('.mobile-connect [data-connect]').click();
  await page.locator('#repo-input').fill('owner/notes'); await page.locator('#token-input').fill('test-read-only-token');
  await page.locator('#connect-submit').click();
  await page.waitForFunction(() => document.querySelector('#result-count').textContent === '3 notes');
  check(!await page.locator('#notice').isVisible(), 'successful population does not cover the reader with a floating readiness notification');
  check(await page.locator('.note-row').count() === 3, 'downloads a repository and lists all notes');
  check(requests.every(r => r.method === 'GET' && r.url.startsWith('https://api.github.com/') && r.auth === 'Bearer test-read-only-token'), 'all authenticated requests are GETs to GitHub only');
  await page.locator('#search').fill('lemon');
  check(await page.locator('.note-row').count() === 1, 'full-text local search works on phone');
  await page.locator('.note-row').click(); await page.waitForSelector('.note-embed');
  check(await page.locator('.article').isVisible(), 'phone opens a dedicated reading view');
  check(await page.locator('.note-embed').innerText().then(t => t.includes('Keep some pasta water.') && !t.includes('Not part of the embed.')), 'note embeds include only the requested heading section');
  await page.waitForFunction(() => [...document.querySelectorAll('.note-embed img')].some(img => img.complete && img.naturalWidth === 1));
  check(await page.locator('.note-embed img[src^="blob:"]').count() === 1, 'internal attachments are fetched directly and displayed as local blobs');
  check(await page.locator('.prose pre').innerText().then(t => t.includes('[[This is code, not a link]]')), 'wikilinks in code remain literal');
  check(!await page.evaluate(() => window.INJECTED), 'raw HTML cannot execute');
  check(await page.locator('.prose a[href^="javascript:"]').count() === 0, 'unsafe Markdown URLs do not become executable links');
  check(await page.locator('.prose img[src^="https:"]').count() === 0, 'external tracking images are not loaded');
  await page.getByRole('link', { name: 'See details' }).click();
  await page.waitForFunction(() => document.querySelector('.note-title').textContent === 'Notes');
  check(await page.locator('.note-title').innerText() === 'Notes', 'wiki navigation resolves notes and headings');
  await page.getByRole('button', { name: '← Library' }).click(); await page.locator('#search').fill('offline');
  check(await page.locator('.note-row').count() === 1, 'search matches body text, not just titles');
  await page.getByRole('button', { name: 'Cooking', exact: true }).click();
  check(await page.locator('.note-row').count() === 0 && await page.getByText('Nothing here just yet.').isVisible(), 'vault filtering and empty state work');
  await page.getByRole('button', { name: 'All vaults', exact: true }).click(); await page.locator('#search').fill('');
  await page.evaluate(() => navigator.serviceWorker.ready); await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  await context.setOffline(true); await page.reload();
  await page.waitForFunction(() => document.querySelector('#result-count').textContent === '3 notes');
  await page.locator('#search').fill('lemon'); await page.locator('.note-row').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.note-embed img')].some(img => img.complete && img.naturalWidth === 1));
  check(await page.locator('.note-embed img[src^="blob:"]').count() === 1, 'previously viewed images render offline');
  check(await page.locator('.note-title').innerText() === 'Lemon pasta', 'offline reload, search and reading use the cached shell and snapshot');
  check(await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('pocket-vault'); r.onsuccess = () => resolve(r.result); });
    return new Promise(resolve => { const r = db.transaction('data').objectStore('data').get('credential'); r.onsuccess = () => resolve(r.result === undefined); });
  }), 'token is not persisted without explicit opt-in');
  await mkdir('/tmp/pocket-vault-qa', { recursive: true });
  await page.screenshot({ path: '/tmp/pocket-vault-qa/mobile-reader.png', fullPage: true, animations: 'disabled' });
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Connection and device settings' }).click();
  await page.locator('#connection-details').evaluate(n => n.open = true);
  await page.locator('#token-input').fill('test-read-only-token'); await page.locator('#remember-token').check();
  await page.locator('#connect-submit').click();
  await page.waitForFunction(() => !document.querySelector('#connection-dialog').open);
  check(await page.evaluate(async () => { const db = await new Promise(resolve => { const r = indexedDB.open('pocket-vault'); r.onsuccess = () => resolve(r.result); }); return new Promise(resolve => { const r = db.transaction('data').objectStore('data').get('credential'); r.onsuccess = () => resolve(r.result === 'test-read-only-token'); }); }), 'remember-token opt-in persists only on this browser');
  const callsBeforeReload = requests.length;
  const openingRefresh = page.waitForRequest(r => r.url().includes('api.github.com') && r.url().includes('/commits'));
  await page.reload();
  await openingRefresh;
  await page.waitForFunction(() => document.querySelector('#result-count').textContent === '3 notes' && !document.querySelector('#refresh').disabled);
  check(requests.length > callsBeforeReload, 'remembered credentials refresh the saved snapshot on opening');
  generation = 2; const before = requests.length;
  await page.getByRole('button', { name: 'Refresh from GitHub' }).click();
  await page.waitForFunction(() => !document.querySelector('#refresh').disabled);
  await page.getByRole('button', { name: '← Library' }).click(); await page.locator('#search').fill('');
  await page.waitForFunction(() => document.querySelector('#result-count').textContent === '2 notes');
  check(!requests.slice(before).some(r => r.url.includes('/git/blobs/')), 'incremental refresh reuses blobs and removes deleted notes');
  fail = true; await page.getByRole('button', { name: 'Refresh from GitHub' }).click();
  await page.waitForFunction(() => document.querySelector('#notice').textContent.includes('denied'));
  check(await page.locator('.note-row').count() === 2, 'failed refresh preserves the last complete snapshot');
  await page.setViewportSize({ width: 1360, height: 940 }); await page.locator('.note-row').first().click();
  await page.locator('#notice').evaluate(n => n.hidden = true);
  await page.screenshot({ path: '/tmp/pocket-vault-qa/desktop-reader.png', fullPage: true, animations: 'disabled' });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'desktop has no horizontal page overflow');
  await page.setViewportSize({ width: 320, height: 720 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow phone has no horizontal page overflow');
  await page.getByRole('button', { name: 'Connection and device settings' }).click();
  page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Forget this device' }).click();
  await page.waitForFunction(() => document.querySelector('#result-count').textContent === 'Your notes live here');
  check(await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('pocket-vault'); r.onsuccess = () => resolve(r.result); });
    const count = store => new Promise(resolve => { const r = db.transaction(store).objectStore(store).count(); r.onsuccess = () => resolve(r.result); });
    return await count('data') === 0 && await count('assets') === 0;
  }), 'forget device clears snapshot, credentials, settings and attachments');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.mobile-connect [data-demo]').click();
  await page.screenshot({ path: '/tmp/pocket-vault-qa/mobile-library.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1360, height: 940 });
  await page.locator('.note-row').filter({ hasText: 'Lemon & herb pasta' }).click();
  await page.locator('#notice').evaluate(n => n.hidden = true);
  await page.screenshot({ path: '/tmp/pocket-vault-qa/desktop-sample.png', fullPage: true, animations: 'disabled' });
  check(errors.length === 0, 'no browser runtime errors');
  console.log(JSON.stringify({ passed: results.length, checks: results, screenshots: '/tmp/pocket-vault-qa' }, null, 2));
} finally { await browser.close(); }
