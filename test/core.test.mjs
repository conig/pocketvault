import test from 'node:test';
import assert from 'node:assert/strict';
import { cachedNote, VAULTS, selectedVaults, selectSavedVaults, allowedPath, repository, parseNote, searchNotes, snippet, resolveFile, fetchSnapshot, github } from '../src/core.js';
const sha = 'a'.repeat(40), treeSha = 'b'.repeat(40);
const commit = (value = sha) => ({ sha: value, commit: { tree: { sha: treeSha } } });
const file = (path, sha = 'file1') => ({ path, sha, type: 'blob', mode: '100644', size: 30 });
function mock(routes) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const endpoint = url.replace('https://api.github.com/repos/owner/notes/', '');
    if (!(endpoint in routes)) throw new Error('Unexpected URL: ' + url);
    const value = routes[endpoint];
    return new Response(JSON.stringify(value), { status: value?.status || 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetcher, calls };
}
const base = { 'commits?per_page=1': [commit()], [`git/trees/${treeSha}?recursive=1`]: { tree: [file('work/Note.md')] }, 'git/blobs/file1': { encoding: 'base64', content: Buffer.from('# Note\nHello world.').toString('base64') } };
test('repository names are constrained to GitHub owner/repository, including a full GitHub URL', () => {
  assert.equal(repository('https://github.com/user/vault.git'), 'user/vault');
  for (const value of ['../x/y', 'https://evil.example/x/y', 'a/b?x=1', 'a/b/c']) assert.throws(() => repository(value));
});
test('only allowlisted vaults and non-hidden, non-traversing paths are downloaded', () => {
  assert.equal(allowedPath('work/Research/Note.md'), true);
  for (const path of ['.aws/credentials', 'work/.env', 'work/.obsidian/data.json', 'codex/../x.md', 'apps/a.md', 'bookmarks.html', 'personal//note.md']) assert.equal(allowedPath(path), false, path);
});
test('parses frontmatter, preserves malformed frontmatter, handles CRLF and searchable Unicode', () => {
  const note = parseNote('cooking/a.md', '---\r\ntitle: Café\r\ntags: [coffee, breakfast]\r\n---\r\n# Café\r\nA warm start.');
  assert.equal(note.title, 'Café'); assert.deepEqual(note.tags, ['coffee', 'breakfast']); assert.ok(!note.body.startsWith('---'));
  assert.ok(parseNote('work/a.md', '---\n[bad yaml\n---\nKeep this').body.includes('Keep this'));
  assert.equal(searchNotes([note], 'cafe breakfast').length, 1);
});
test('searches full content with AND terms, phrases, vault filters, title ranking, and complete results', () => {
  const notes = [parseNote('work/a.md', '# Plan\nA lemon cake in a long note.'), parseNote('cooking/b.md', '# Lemon cake\nDessert for two.'), parseNote('personal/c.md', '# Walking\nA lemon tree.')];
  assert.equal(searchNotes(notes, 'lemon cake')[0].title, 'Lemon cake');
  assert.equal(searchNotes(notes, '"lemon cake"', 'work').length, 1);
  assert.equal(searchNotes(notes, 'lemon', 'personal').length, 1);
  assert.equal(searchNotes(notes, 'missing').length, 0);
  assert.ok(snippet(notes[0], 'lemon').includes('lemon'));
  assert.equal(searchNotes(Array.from({ length: 600 }, (_, i) => parseNote(`work/${i}.md`, `# ${i}\nmatch`)), 'match').length, 600);
});
test('resolves relative, wiki, encoded and heading links without guessing ambiguous notes', () => {
  const files = ['work/folder/a.md', 'work/Other.md', 'cooking/Other.md', 'work/folder/image.png', 'work/My note.md'].map(path => ({ path }));
  assert.deepEqual(resolveFile('../Other#Section', 'work/folder/a.md', files), { path: 'work/Other.md', anchor: 'Section' });
  assert.equal(resolveFile('Other', 'work/folder/a.md', files).path, 'work/Other.md');
  assert.equal(resolveFile('My%20note', 'work/folder/a.md', files).path, 'work/My note.md');
  assert.equal(resolveFile('image.png', 'work/folder/a.md', files).path, 'work/folder/image.png');
  assert.equal(resolveFile('Other', 'personal/a.md', files), null);
  assert.equal(resolveFile('missing', 'work/a.md', files), null);
});
test('downloads a pinned snapshot with GET-only requests to api.github.com', async () => {
  const { fetcher, calls } = mock(base);
  const snap = await fetchSnapshot({ repo: 'owner/notes', branch: '' }, 'fake-read-token', null, { fetcher });
  assert.equal(snap.notes[0].title, 'Note'); assert.equal(snap.commit, sha);
  assert.ok(calls.every(c => c.options.method === 'GET' && c.options.credentials === 'omit' && c.options.redirect === 'error'));
  assert.ok(calls.every(c => new URL(c.url).origin === 'https://api.github.com'));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fake-read-token');
});
test('unchanged commits use one request; changed snapshots reuse unchanged blobs and remove deleted files', async () => {
  const previous = { repo: 'owner/notes', branch: '', commit: 'old', notes: [parseNote('work/Note.md', '# Cached', 'file1'), parseNote('personal/Deleted.md', '# Delete', 'gone')], files: [] };
  const { fetcher, calls } = mock(base);
  const next = await fetchSnapshot({ repo: 'owner/notes', branch: '' }, 'token', previous, { fetcher });
  assert.equal(next.notes.length, 1); assert.equal(next.notes[0].title, 'Cached'); assert.equal(calls.length, 2);
  const again = mock({ 'commits?per_page=1': [commit()] });
  const same = await fetchSnapshot({ repo: 'owner/notes', branch: '' }, 'token', next, { fetcher: again.fetcher });
  assert.equal(again.calls.length, 1); assert.deepEqual(same.notes, next.notes);
});
test('does not reuse cached notes from another repository or branch', async () => {
  const { fetcher, calls } = mock(base);
  const previous = { repo: 'other/repo', branch: '', commit: sha, notes: [parseNote('work/Note.md', '# Wrong repo', 'file1')] };
  const next = await fetchSnapshot({ repo: 'owner/notes', branch: '' }, '', previous, { fetcher });
  assert.equal(calls.length, 3); assert.equal(next.notes[0].title, 'Note');
});
test('excludes symlinks and non-vault files from a snapshot', async () => {
  const routes = structuredClone(base);
  routes[`git/trees/${treeSha}?recursive=1`].tree.push(file('.aws/credentials'), { ...file('work/link.md'), mode: '120000' }, file('apps/app.md'));
  const { fetcher } = mock(routes);
  const next = await fetchSnapshot({ repo: 'owner/notes', branch: '' }, '', null, { fetcher });
  assert.deepEqual(next.files.map(f => f.path), ['work/Note.md']);
});
test('truncated trees, missing permissions and failed blobs reject rather than save partial results', async () => {
  for (const routes of [
    { ...base, [`git/trees/${treeSha}?recursive=1`]: { truncated: true, tree: [] } },
    { ...base, 'git/blobs/file1': { status: 403 } },
    { 'commits?per_page=1': { status: 401 } }
  ]) {
    const { fetcher } = mock(routes);
    await assert.rejects(fetchSnapshot({ repo: 'owner/notes', branch: '' }, 'token', null, { fetcher }));
  }
});
test('branch names are encoded, requests can be aborted, and public requests omit Authorization', async () => {
  const { fetcher, calls } = mock({ 'commits/feature%2Fnotes': commit(), ...base });
  await fetchSnapshot({ repo: 'owner/notes', branch: 'feature/notes' }, '', null, { fetcher });
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.ok(calls[0].url.endsWith('feature%2Fnotes'));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(fetchSnapshot({ repo: 'owner/notes', branch: '' }, '', null, { fetcher, signal: abort.signal }));
});

test('vault selections default safely for existing installs and reject empty/unknown choices', () => {
  assert.deepEqual(selectedVaults(undefined), VAULTS);
  assert.deepEqual(selectedVaults(['cooking', 'work', 'cooking']), ['work', 'cooking']);
  for (const selection of [[], ['.aws'], ['work', '../personal'], 'work', null]) assert.throws(() => selectedVaults(selection));
});
test('selected snapshots download no excluded note contents and keep only vault counts', async () => {
  const routes = structuredClone(base);
  routes[`git/trees/${treeSha}?recursive=1`].tree.push(file('cooking/Recipe.md', 'recipe'), file('work/image.png', 'image'));
  routes['git/blobs/recipe'] = { encoding: 'base64', content: Buffer.from('# Recipe\nLemon').toString('base64') };
  const { fetcher, calls } = mock(routes);
  const snap = await fetchSnapshot({ repo: 'owner/notes', branch: '', vaults: ['cooking'] }, '', null, { fetcher });
  assert.deepEqual(snap.notes.map(n => n.path), ['cooking/Recipe.md']);
  assert.deepEqual(snap.files.map(f => f.path), ['cooking/Recipe.md']);
  assert.equal(snap.vaultCounts.work, 1); assert.equal(snap.vaultCounts.cooking, 1);
  assert.equal(snap.catalog, undefined);
  assert.ok(!calls.some(c => c.url.endsWith('/file1')));
});
test('adding a vault on the same commit fetches its missing contents without redownloading saved notes', async () => {
  const routes = structuredClone(base);
  routes[`git/trees/${treeSha}?recursive=1`].tree.push(file('cooking/Recipe.md', 'recipe'));
  routes['git/blobs/recipe'] = { encoding: 'base64', content: Buffer.from('# Recipe').toString('base64') };
  const previous = { repo: 'owner/notes', branch: '', commit: sha, vaults: ['work'], notes: [parseNote('work/Note.md', '# Cached', 'file1')], files: [file('work/Note.md')] };
  const { fetcher, calls } = mock(routes);
  const snap = await fetchSnapshot({ repo: 'owner/notes', branch: '', vaults: ['work', 'cooking'] }, '', previous, { fetcher });
  assert.equal(snap.notes.length, 2); assert.equal(snap.notes[0].title, 'Cached');
  assert.equal(calls.filter(c => c.url.includes('/git/blobs/')).length, 1);
  assert.ok(calls.some(c => c.url.endsWith('/recipe')));
  assert.deepEqual(previous.vaults, ['work']);
});
test('offline removal drops excluded notes/files, preserves counts/freshness, and refuses uncached expansion', () => {
  const old = { repo: 'owner/notes', branch: '', commit: sha, checkedAt: 123, notes: [parseNote('work/Note.md', '# Work'), parseNote('cooking/Recipe.md', '# Recipe')], files: [file('work/Note.md'), file('work/image.png'), file('cooking/Recipe.md')] };
  const subset = selectSavedVaults(old, ['cooking']);
  assert.equal(subset.checkedAt, 123); assert.equal(subset.commit, sha);
  assert.deepEqual(subset.notes.map(n => n.vault), ['cooking']); assert.equal(subset.files.length, 1);
  assert.equal(subset.vaultCounts.work, 1); assert.equal(old.notes.length, 2);
  assert.throws(() => selectSavedVaults(subset, ['work', 'cooking']), /download newly selected/);
});
test('a selected empty vault is valid and keeps available-vault counts for settings', async () => {
  const { fetcher, calls } = mock(base);
  const snap = await fetchSnapshot({ repo: 'owner/notes', branch: '', vaults: ['cooking'] }, '', null, { fetcher });
  assert.equal(snap.notes.length, 0); assert.equal(snap.vaultCounts.work, 1);
  assert.equal(calls.length, 2);
});

test('human aliases and tags take priority over timestamp identifiers', () => {
  const note = parseNote('work/1770000000-project-plan.md', '---\nid: 1770000000-project-plan\naliases: [Project plan]\ntags: [work, project/alpha]\n---\n# 1770000000-project-plan\n\nTags: `System-Setup`, `work`\n\nAn #idea.\n\n```text\n#not-a-tag\n```');
  assert.equal(note.title, 'Project plan');
  assert.deepEqual(note.tags, ['work','project/alpha','System-Setup','idea']);
  assert.ok(!note.plain.includes('1770000000'));
  assert.equal(searchNotes([note], '#project').length, 1);
  assert.equal(searchNotes([note], '', 'all', 'system-setup').length, 1);
  assert.equal(searchNotes([note], '#missing').length, 0);
});
test('old cached notes remain usable immediately without pretending frontmatter was recovered', () => {
  const migrated = cachedNote({ path:'work/1770000000-project-plan.md', title:'1770000000-project-plan', body:'# 1770000000-project-plan\n\nTags: `work`\n\nReference', tags:[], sha:'old', vault:'work' });
  assert.equal(migrated.title,'project plan'); assert.deepEqual(migrated.tags,['work']); assert.equal(migrated.formatVersion,0);
});
test('useful metadata is compact and generated identifiers do not become title fallbacks', () => {
  const n = parseNote('cooking/1770000000-lemon-pasta.md','---\ntitle: Lemon pasta\ndate: 2026-11-02\nserves: 2\nprep: 10 min\nrating: 92\n---\nA quick dinner.');
  assert.equal(n.title,'Lemon pasta'); assert.equal(n.date,'2026-11-02'); assert.equal(n.minutes,1); assert.equal(n.facts.length,3);
  assert.equal(parseNote('work/1770000000-project-plan.md','# 1770000000-project-plan').title,'project plan');
});
