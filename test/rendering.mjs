import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--class=codex-smoke-test']});
const context=await browser.newContext({viewport:{width:390,height:844}}), page=await context.newPage();
const raw='---\nid: 1770000000-internal-note\naliases: [Useful human title]\ntags: [reference, project/alpha]\n---\nTags: `System-Setup`, `Markdown`\n\n# 1770000000-internal-note\n\nA #research note with **bold**, *emphasis*, ~~removed~~ and ==highlighted== text.\n\n## Lists\n\n- [x] Finished\n- [ ] Pending\n\n## Evidence\n\nA cited point[^source].\n\n[^source]: Supporting evidence.\n\n> [!note] Important\n> A useful callout.\n\n## Maths\n\nInline $x^2$ and display:\n\n$$\n\\frac{a}{b}\n$$\n\n## Data\n\n| Item | Value |\n|---|---:|\n| A | 4 |\n\n```js\nconst value = 4;\n```\n\n<details><summary>Extra detail</summary>Safe HTML<br>line two</details>\n<script>window.BAD=true</script>\n<img src="x" onerror="window.BAD=true">';
await context.route('https://api.github.com/**',route=>{const url=route.request().url();const data=url.includes('/commits?')?[{sha:'commit',commit:{tree:{sha:'tree'}}}]:url.includes('/git/trees/')?{tree:[{path:'work/1770000000-internal-note.md',sha:'note',type:'blob',mode:'100644',size:raw.length}]}:{encoding:'base64',content:Buffer.from(raw).toString('base64')};return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});});
try{
 await page.goto('http://127.0.0.1:4173');await page.locator('.mobile-connect [data-connect]').click();await page.locator('#repo-input').fill('fixture/notes');await page.locator('#connect-submit').click();await page.waitForSelector('.note-row');
 const rowTitle=await page.locator('.note-row h2').innerText();console.log(JSON.stringify({rowTitle}));
 assert.equal(rowTitle,'Useful human title','Human aliases must take precedence over generated IDs.');
 assert.ok((await page.locator('.row-tags').innerText()).includes('#System-Setup'));
 await page.locator('#tag-filter').selectOption('System-Setup'); assert.equal(await page.locator('.note-row').count(),1);
 await page.locator('.note-row').click();
 for(const [selector,description] of [['.note-tags','visible tags'],['.prose mark','highlights'],['.prose input[type=checkbox][disabled]','read-only tasks'],['.footnotes','footnotes'],['.callout','callouts'],['.katex','math'],['.prose table','tables'],['.prose code .hljs-keyword','syntax highlighting'],['.prose details summary','safe HTML']]){await page.locator(selector).first().waitFor({timeout:10000});console.log('PASS '+description);}
 assert.equal(await page.locator('.prose input:checked').count(),1);assert.equal(await page.evaluate(()=>!!window.BAD),false);
 assert.ok((await page.locator('.note-tags').innerText()).includes('System-Setup'));
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.evaluate(()=>document.fonts.check('14px \"JetBrains Mono\"')),true);
 const fontCDP=await context.newCDPSession(page);await fontCDP.send('DOM.enable');await fontCDP.send('CSS.enable');
 const root=await fontCDP.send('DOM.getDocument');const titleNode=await fontCDP.send('DOM.querySelector',{nodeId:root.root.nodeId,selector:'.note-title'});
 const fonts=await fontCDP.send('CSS.getPlatformFontsForNode',{nodeId:titleNode.nodeId});
 assert.ok(fonts.fonts.some(f=>f.familyName.includes('JetBrains Mono') && f.isCustomFont),'The title must actually use the bundled JetBrains font, not a fallback.');
 assert.equal(await page.locator('.prose td').last().evaluate(n=>getComputedStyle(n).textAlign),'right');
 assert.equal(await page.locator('.article-footer').evaluate(n=>n.open),false);
 assert.equal(await page.locator('.reader-breadcrumb').innerText(),'work');
 assert.equal(await page.locator('.prose h1').count(),0);
 await mkdir('/tmp/pocket-vault-qa',{recursive:true});
 await page.locator('#notice').evaluate(n=>n.hidden=true);
 await page.screenshot({path:'/tmp/pocket-vault-qa/terminal-markdown-mobile.png',fullPage:true,animations:'disabled'});
 await page.locator('.footnote-ref a').click();
 assert.ok(await page.locator('#reader').evaluate(n=>n.scrollTop)>0);
 await page.evaluate(()=>navigator.serviceWorker.ready); await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 await context.setOffline(true); await page.reload(); await page.waitForSelector('.note-title'); await page.locator('.katex').first().waitFor();
 assert.equal(await page.evaluate(()=>document.fonts.ready.then(()=>document.fonts.check('14px \"JetBrains Mono\"'))),true);
 await page.setViewportSize({width:1360,height:940}); await page.screenshot({path:'/tmp/pocket-vault-qa/terminal-markdown-desktop.png',fullPage:true,animations:'disabled'});
 console.log('PASS human titles, YAML/plain/inline tags, Markdown extensions, and injection safety.');
}finally{await browser.close();}
