import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
await build({ entryPoints: ['src/app.js'], bundle: true, minify: true, format: 'esm', target: ['es2022'], outfile: 'dist/app.js', legalComments: 'none' });
// Every changed release gets a new atomic offline shell, without manual cache bumps.
const hash = createHash('sha256');
for (const name of (await readdir('dist')).filter(n => n !== 'sw.js').sort()) hash.update(await readFile('dist/' + name));
const version = hash.digest('hex').slice(0, 12);
await writeFile('dist/sw.js', (await readFile('public/sw.js', 'utf8')).replace('pocket-vault-shell-v1', `pocket-vault-shell-${version}`));
console.log(`Built offline shell ${version}`);
