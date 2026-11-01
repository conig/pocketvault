import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DEFAULT_THEME, validateCatalog, themeVariables, themeCSS} from '../src/theme-palette.js';
const catalog=JSON.parse(await readFile(new URL('../src/themes/base46.json',import.meta.url),'utf8'));
test('bundled base46 catalog has complete validated dark and light palettes and pinned provenance',()=>{
  validateCatalog(catalog);
  assert.match(catalog.upstream.revision,/^[a-f0-9]{40}$/);
  assert.equal(catalog.upstream.url,'https://github.com/NvChad/base46');
  assert.ok(Object.keys(catalog.themes).length>=98);
  for(const id of ['onedark','one_light','catppuccin','catppuccin-latte','gruvbox','nord','tokyonight','rosepine','slatewave']) assert.ok(catalog.themes[id],id);
  assert.deepEqual(new Set(Object.values(catalog.themes).map(t=>t.type)),new Set(['dark','light']));
  assert.equal(catalog.themes[DEFAULT_THEME].base_30.black,'#1e222a');
  for(const theme of Object.values(catalog.themes)) assert.equal(Object.keys(theme.base_16).length,16);
});
test('theme mapping uses base30 UI and base16 syntax, with a default and every theme in CSS',()=>{
  const css=themeCSS(catalog);
  assert.ok(css.includes(':root,:root[data-theme="onedark"]'));
  for(const [id,theme] of Object.entries(catalog.themes)) {
    assert.ok(css.includes(`:root[data-theme="${id}"]`),id);
    const vars=themeVariables(theme);
    assert.equal(vars['--paper'],theme.base_30.black);
    assert.equal(vars['--chrome'],theme.base_30.darker_black);
    assert.equal(vars['--heading'],theme.base_16.base0D);
    assert.equal(vars['--link'],theme.base_16.base0C);
    assert.ok(!Object.values(vars).includes(undefined),id);
  }
});
test('malformed, incomplete or CSS-injecting palette data is rejected at build time',()=>{
  for(const mutate of [
    c=>delete c.themes.onedark,
    c=>c.themes.onedark.type='auto',
    c=>delete c.themes.onedark.base_16.base0F,
    c=>delete c.themes.onedark.base_30.black,
    c=>c.themes.onedark.base_30.blue='red;display:none',
    c=>c.themes['bad"]{}']=c.themes.onedark,
  ]) {
    const invalid=structuredClone(catalog);mutate(invalid);
    assert.throws(()=>themeCSS(invalid));
  }
});
