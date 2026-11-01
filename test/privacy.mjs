import {chromium} from 'playwright';
import assert from 'node:assert/strict';

// Real built-app/IndexedDB coverage, exclusively synthetic repos and credentials.
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',headless:true,args:['--no-sandbox','--class=codex-smoke-test']});
const errors = [];
async function scenario(repos, branches, action) {
  const context = await browser.newContext({viewport:{width:390,height:844},isMobile:true}); const page = await context.newPage();
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('https://api.github.com/**', async route => {
    const req = route.request(), url = new URL(req.url()); requests.push({url,auth:req.headers().authorization});
    let data;
    if (url.pathname === '/user/repos') {
      if (repos === 'rejected') return route.fulfill({status:401,contentType:'application/json',body:'{}'});
      data = repos.map(full_name => ({full_name}));
    } else if (url.pathname.endsWith('/branches')) data = branches[url.pathname.split('/')[3]].map(name => ({name}));
    else if (url.pathname.includes('/commits')) data = [{sha:'commit',commit:{tree:{sha:'tree'}}}];
    else if (url.pathname.includes('/git/trees/')) data = {tree:[{path:'work/Note.md',sha:'blob',type:'blob',mode:'100644',size:30}]};
    else if (url.pathname.includes('/git/blobs/')) data = {encoding:'base64',content:Buffer.from('# Synthetic note\n\nTest only.').toString('base64')};
    else data = {default_branch:branches[url.pathname.split('/')[3]][0]};
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  try {
    await page.goto('http://127.0.0.1:4173'); await page.locator('#token-input').waitFor({state:'visible'});
    assert.ok(await page.locator('#repo-input').inputValue().then(value => value === ''), 'no private repository may be prefilled');
    assert.equal(await page.locator('#repo-input').getAttribute('placeholder'),'user/vault');
    assert.equal(await page.locator('#repo-input').isVisible(),false,'first step asks only for token/remember');
    assert.equal(requests.length,0,'no unsolicited repository requests');
    await page.screenshot({path:'/tmp/pocketvault-privacy-81fe72fr/setup-token.png'});
    await action(page, requests);
  } finally {await context.close();}
}
const start = async page => {await page.locator('#token-input').fill('fake-read-token');await page.locator('#remember-token').check();await page.locator('#connect-submit').click();};
try {
  await scenario(['fixture/notes'],{notes:['trunk']},async (page,requests) => {
    await start(page); await page.locator('.note-row').waitFor();
    assert.equal(await page.locator('#source-dialog').isVisible(),false,'single repo/single branch skips second popup');
    assert.ok(requests.every(req => req.auth === 'Bearer fake-read-token'));
    await page.reload(); await page.locator('.note-row').waitFor(); await page.locator('#settings').click();
    assert.equal(await page.locator('#repo-input').inputValue(),'fixture/notes','saved connection survives reload');
    page.once('dialog',dialog => dialog.accept());await page.locator('#forget').click();
    await page.waitForFunction(() => document.querySelector('#connection-dialog').open && document.querySelector('#result-count').textContent === 'Your notes live here');
    assert.ok(await page.locator('#repo-input').inputValue().then(value => value === ''),'forget clears repository');
    assert.equal(await page.locator('#token-input').inputValue(),'');
    await page.reload(); await page.locator('#token-input').waitFor();
    assert.ok(await page.locator('#repo-input').inputValue().then(value => value === ''),'forgotten repo stays cleared');
  });
  await scenario(['fixture/notes','fixture/other'],{notes:['main'],other:['trunk','draft']},async (page,requests) => {
    await start(page);await page.locator('#source-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#repo-select option').count(),2);
    await page.screenshot({path:'/tmp/pocketvault-privacy-81fe72fr/setup-source.png'});
    assert.equal(await page.locator('#branch-select').isVisible(),true,'branch picker always present in second popup');
    await page.locator('#repo-select').selectOption('fixture/other');
    await page.waitForFunction(() => document.querySelector('#branch-select').options.length === 2);
    assert.equal(await page.locator('#branch-select').inputValue(),'','non-main default is initially selected');
    await page.locator('#branch-select').selectOption('draft');await page.locator('#source-submit').click();
    await page.locator('.note-row').waitFor();
    assert.ok(requests.some(req => req.url.pathname.endsWith('/commits/draft')),'selected branch actually used');
  });
  await scenario(['fixture/notes'],{notes:['trunk','draft']},async page => {
    await start(page);await page.locator('#source-dialog').waitFor({state:'visible'});
    assert.equal(await page.locator('#branch-select option').count(),2);
    await page.locator('#source-back').click();await page.locator('#token-input').waitFor();
    assert.equal(await page.locator('#token-input').inputValue(),'fake-read-token','back preserves unsaved input');
    await page.locator('#connect-submit').click();await page.locator('#source-dialog').waitFor({state:'visible'});
    // Empty option value means the default branch and must not fail HTML validity.
    await page.locator('#source-submit').click();await page.locator('.note-row').waitFor();
  });
  await scenario('rejected',{},async page => {
    await start(page);await page.locator('#connection-error').waitFor({state:'visible'});
    assert.match(await page.locator('#connection-error').innerText(),/rejected the token/);
    assert.equal(await page.locator('#source-dialog').isVisible(),false);
    assert.equal(await page.locator('#connect-submit').isDisabled(),false);
  });
  await scenario([],{notes:['main']},async page => {
    await page.locator('#manual-connection').evaluate(node => node.open=true);
    await page.locator('#repo-input').fill('fixture/notes');await page.locator('#connect-submit').click();
    await page.locator('.note-row').waitFor();
  });
  assert.deepEqual(errors,[]);
  console.log('PASS token-first setup, one-repo auto-connect, two-step repo/branch choice, non-main/default branches, Back, invalid token, manual fallback, retention and forget-device privacy.');
} finally {await browser.close();}
