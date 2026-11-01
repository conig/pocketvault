// Import a reviewed, clean upstream checkout. Lua is needed only for this
// maintenance command, never to build or use Pocket Vault.
import {execFileSync} from 'node:child_process';
import {readFile, writeFile, readdir, copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {validateCatalog} from '../src/theme-palette.js';
const checkout=process.argv[2];
if (!checkout) throw new Error('Usage: node scripts/import-base46.mjs /path/to/NvChad/base46');
const root=resolve(checkout);
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8'}).trim();
if (git('status','--porcelain')) throw new Error('Use a clean upstream checkout, not user-customized themes.');
const themes={};
const loader=`
package.preload.base46 = function() return {override_theme = function(theme) return theme end} end
package.preload.nvconfig = function() return {
  base46 = {transparency = false},
  ui = {statusline = {theme = "default"}, telescope = {style = "borderless"}, cmp = {style = "default"}}
} end
local theme = dofile(arg[1])
print("type\\t" .. theme.type)
for _, group in ipairs({"base_30", "base_16"}) do
  for key, color in pairs(theme[group]) do print(group .. "\\t" .. key .. "\\t" .. color) end
end
`;
const names=(await readdir(`${root}/lua/base46/themes`)).filter(n=>n.endsWith('.lua')).sort();
for (const name of names) {
 const path=`${root}/lua/base46/themes/${name}`;
 const theme={base_30:{},base_16:{}};
 for (const line of execFileSync('lua',['-',path],{input:loader,encoding:'utf8'}).trim().split('\n')) {
  const [group,key,color]=line.split('\t');
  if(group==='type') theme.type=key;
  else theme[group][key]=color;
 }
 for (const group of ['base_30','base_16']) theme[group]=Object.fromEntries(Object.entries(theme[group]).sort(([a],[b])=>a.localeCompare(b)));
 const source=await readFile(path,'utf8');
 theme.credits=source.match(/^(?:--[^\n]*\n|\s*\n)*/)[0].trim();
 themes[name.slice(0,-4)]=theme;
}
const catalog={upstream:{url:'https://github.com/NvChad/base46',revision:git('rev-parse','HEAD')},themes};
validateCatalog(catalog);
await writeFile('src/themes/base46.json',JSON.stringify(catalog,null,2)+'\n');
for(const name of ['LICENSE','base16-LICENSE']) await copyFile(`${root}/${name}`,`third_party/base46/${name}.txt`);
console.log(`Imported all ${names.length} themes at ${catalog.upstream.revision}.`);
