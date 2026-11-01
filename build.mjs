import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await cp('node_modules/katex/dist/katex.min.css','dist/katex.css');
await cp('node_modules/katex/LICENSE','dist/fonts/LICENSE-KaTeX.txt');
for (const name of await readdir('node_modules/katex/dist/fonts')) if (name.endsWith('.woff2')) await cp('node_modules/katex/dist/fonts/'+name,'dist/fonts/'+name);
await build({ entryPoints: ['src/app.js'], bundle: true, splitting: true, minify: true, format: 'esm', target: ['es2022'], outdir: 'dist', chunkNames:'chunks/[name]-[hash]', legalComments: 'none' });
async function files(dir='dist') { const all=[]; for (const entry of await readdir(dir,{withFileTypes:true})) { const path=dir+'/'+entry.name; if(entry.isDirectory()) all.push(...await files(path));else all.push(path); } return all; }
const assets=(await files()).filter(n=>!n.endsWith('/sw.js')).sort();
const hash=createHash('sha256');for (const path of assets) hash.update(await readFile(path));
hash.update(await readFile('public/sw.js'));
const version=hash.digest('hex').slice(0,12);
const shell=['/',...assets.map(n=>'/'+n.slice(5)).filter(n=>!n.endsWith('.txt'))];
await writeFile('dist/sw.js',(await readFile('public/sw.js','utf8')).replace('pocket-vault-shell-v1',`pocket-vault-shell-${version}`).replace('__SHELL__',JSON.stringify(shell)));
console.log(`Built offline shell ${version} (${assets.length} assets)`);
