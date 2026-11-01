// Reader tags must navigate to all matching saved notes, not remain inert source
// or intersect an old search/vault filter. Exercise the built app and real cache.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const origin = process.env.POCKETVAULT_URL || 'http://127.0.0.1:4173';

const docs = [
  { path: 'work/Field notes.md', text: '---\ntags: [yaml-only]\n---\n# Field notes\n\nTags: `Project/Alpha`, reference\n\nInline #café/été and #PROJECT/alpha.\n\n`#Project/Alpha` and [#Project/Alpha](https://example.com).\n\n```md\nTags: #Project/Alpha\n#Project/Alpha\n```\n\n    #Project/Alpha\n\n\\#Project/Alpha\n\n<script>#Project/Alpha</script>\n' },
  { path: 'personal/Related.md', text: '---\ntags: [project/alpha, yaml-only]\n---\n# Related\n\nAnother vault.' },
  { path: 'cooking/Child.md', text: '# Child\n\n#project/alpha/beta' },
  { path: 'codex/Unicode.md', text: '# Unicode\n\n#café/été' },
  { path: 'work/Unrelated.md', text: '# Unrelated\n\n#project/alphabet' },
].map((doc, i) => ({ ...doc, sha: `note${i}` }));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--class=codex-smoke-test'] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
await context.route('https://api.github.com/**', route => {
  const url = route.request().url();
  const value = url.includes('/commits?') ? [{ sha: 'commit', commit: { tree: { sha: 'tree' } } }]
    : url.includes('/git/trees/') ? { tree: docs.map(d => ({ path: d.path, sha: d.sha, type: 'blob', mode: '100644', size: Buffer.byteLength(d.text) })) }
      : { encoding: 'base64', content: Buffer.from(docs.find(d => url.endsWith('/' + d.sha)).text).toString('base64') };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});
const noteHash = '#note=' + encodeURIComponent(docs[0].path);
async function openField() {
  await page.evaluate(hash => { location.hash = hash; }, noteHash);
  await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();
}
async function expectResults(titles) {
  await page.waitForFunction(() => !document.querySelector('.workspace').classList.contains('note-open'));
  assert.deepEqual((await page.locator('.note-row h2').allTextContents()).sort(), [...titles].sort());
  assert.equal(await page.locator('#search').inputValue(), '');
  assert.equal(await page.locator('#filters .active').textContent(), 'All vaults');
}
try {
  await page.goto(origin);
  await page.locator('#manual-connection').evaluate(node => node.open = true);await page.locator('#repo-input').fill('fixture/notes');
  await page.locator('#connect-submit').click();
  await page.waitForFunction(() => document.querySelectorAll('.note-row').length === 5);
  for (const width of [390, 1360]) {
    await page.setViewportSize({ width, height: 844 });
    // Deliberately hide related notes with both filters before opening the note.
    await page.locator('#search').fill('Field');
    await page.locator('.filter-menu').evaluate(n => { n.open = true; });
    await page.locator('#tag-filter').selectOption('');
    await page.locator('#filters button').filter({ hasText: /^Work$/ }).click();
    await page.locator('.filter-menu').evaluate(n => { n.open = false; });
    await page.locator('.note-row').click();
    await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();
    const plain = page.locator('.source-view a[data-tag="Project/Alpha"]');
    assert.equal(await plain.count(), 2, 'Both the backtick Tags line and case-insensitive inline hashtag must be links.');
    assert.equal(await page.locator('.source-view .syntax-code a').count(), 0, 'Code examples are not tag navigation.');
    assert.equal(await page.locator('.source-view script').count(), 0);
    assert.equal(await page.locator('.source-view a[href="https://example.com"]').count(), 1, 'Existing Markdown links must stay intact.');
    assert.equal(await page.locator('.source-view a[data-tag="reference"]').count(), 1, 'Bare Tags line values must be linked.');
    await page.screenshot({ path: `/tmp/pocket-tag-reader-${width}.png` });
    await plain.first().click();
    await expectResults(['Child', 'Field notes', 'Related']);
    assert.equal(await page.locator('#tag-filter').inputValue(), 'Project/Alpha');
    assert.equal(new URL(page.url()).hash, '#tag=Project%2FAlpha');
    await page.screenshot({ path: `/tmp/pocket-tag-results-${width}.png` });
    await page.goBack();
    await page.locator('[data-syntax-engine="tree-sitter"]').waitFor();
    assert.equal(new URL(page.url()).hash, noteHash, 'Browser Back returns to the source note.');
    await page.locator('.source-view a[data-tag="café/été"]').click();
    await expectResults(['Field notes', 'Unicode']);
    await openField();
    const yaml = page.locator('.note-tags a[data-tag="yaml-only"]');
    assert.equal(await yaml.count(), 1, 'Parsed YAML tags must also be accessible from the reader.');
    await yaml.focus();
    await page.keyboard.press('Enter');
    await expectResults(['Field notes', 'Related']);
    console.log(`PASS ${width}px: source/YAML tags, keyboard navigation, all-vault results and Browser Back.`);
  }
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true);
  await page.reload();
  await page.locator('.note-row').first().waitFor();
  await expectResults(['Field notes', 'Related']);
  assert.equal(await page.locator('#tag-filter').inputValue(), 'yaml-only');
  await openField();
  await page.locator('.source-view a[data-tag="reference"]').click();
  await expectResults(['Field notes']);
  // Parent/old copied URLs remain actual filters even without an exact option.
  await page.goto(origin + '/#tag=project');
  await page.locator('.note-row').first().waitFor();
  await expectResults(['Child', 'Field notes', 'Related', 'Unrelated']);
  await openField();
  await page.evaluate(() => { location.hash = '#tag=removed-tag'; });
  await expectResults([]);
  await page.locator('.filter-menu > summary').click();
  await page.locator('#tag-filter').selectOption('');
  assert.equal(new URL(page.url()).hash, '', 'Clearing a linked tag filter also clears its URL.');
  await page.reload();
  await page.locator('.note-row').first().waitFor();
  await expectResults(['Child', 'Field notes', 'Related', 'Unicode', 'Unrelated']);
  assert.deepEqual(errors, []);
  console.log('PASS tag URLs restore offline and source tag navigation works from cached notes.');
} finally {
  await browser.close();
}
