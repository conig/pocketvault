import { VAULTS, repository, searchNotes, snippet, parseNote, fetchSnapshot, github, bytesFromBase64, fold } from './core.js';
import { read, saveConnection, clearAll, readAsset, writeAsset } from './storage.js';
import { renderMarkdown, decorate } from './render.js';
const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
let snapshot = null, config = { repo: 'user/vault', branch: '' }, token = '', remembered = false;
let vault = 'all', selected = '', busy = false, demo = false, controller, noticeTimer, epoch = 0, renderVersion = 0;
const urls = new Map();
function toast(message, timeout = 6500) { $('#notice').textContent = message; $('#notice').hidden = false; clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { $('#notice').hidden = true; }, timeout); }
function revokeAssets() { for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear(); }
function status() {
  const indicator = $('#connection-dot'); indicator.className = 'dot';
  if (busy) return;
  if (demo) { $('#sync-status').textContent = 'Sample notes · not your repository'; indicator.classList.add('demo'); }
  else if (snapshot) {
    const date = new Date(snapshot.checkedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    $('#sync-status').textContent = navigator.onLine ? `Checked ${date} · saved on this device` : 'Offline · reading saved notes';
    $('#sync-status').title = `Last checked ${new Date(snapshot.checkedAt).toLocaleString()} · ${snapshot.commit.slice(0, 7)}`;
    indicator.classList.add('connected');
  } else $('#sync-status').textContent = 'Not connected';
}
function filters() {
  const root = $('#filters'); root.replaceChildren();
  for (const value of ['all', ...VAULTS]) {
    const button = el('button', `filter${vault === value ? ' active' : ''}`, value === 'all' ? 'All vaults' : value[0].toUpperCase() + value.slice(1));
    button.type = 'button'; button.setAttribute('aria-pressed', String(vault === value));
    button.onclick = () => { vault = value; filters(); drawList(); };
    root.append(button);
  }
}
function openSettings() {
  $('#repo-input').value = config.repo;
  $('#branch-input').value = config.branch;
  $('#token-input').value = token;
  $('#remember-token').checked = remembered;
  $('#connection-error').hidden = true;
  $('#connection-dialog').showModal();
}
function connectionActions(root) {
  root.querySelector('[data-connect]')?.addEventListener('click', openSettings);
  root.querySelector('[data-demo]')?.addEventListener('click', loadDemo);
}
function welcome() {
  const root = $('#reader-content'); root.replaceChildren();
  const block = el('div', 'welcome');
  if (snapshot) {
    block.innerHTML = '<div class="welcome-mark" aria-hidden="true">[[ ]]</div><div class="eyebrow">SPACE TO THINK</div><h2>Your notes.<br>A little more accessible.</h2><p>Choose a note or search your library. Everything here is ready to read, even offline.</p><div class="welcome-foot">READ ONLY · NO INBOX · NO DISTRACTIONS</div>';
  } else {
    block.innerHTML = '<div class="welcome-mark" aria-hidden="true">[[ ]]</div><div class="eyebrow">YOUR VAULTS, WITH YOU</div><h2>A quiet place<br>for everything you know.</h2><p>Find a recipe, revisit an idea, look up that thing you wrote down. Your notes, without the editing tools.</p><button class="primary" data-connect>Connect GitHub <span>↗</span></button><button class="text-button" data-demo>Explore a sample library</button><div class="welcome-foot">PRIVATE BY DESIGN<br>Read-only GitHub access. Search and read offline.</div>';
  }
  root.append(block); connectionActions(block);
}
function drawList() {
  const list = $('#note-list'); list.replaceChildren();
  $('#demo-badge').hidden = !demo;
  const notes = snapshot ? searchNotes(snapshot.notes, $('#search').value, vault) : [];
  $('#result-count').textContent = snapshot ? `${notes.length.toLocaleString()} ${notes.length === 1 ? 'note' : 'notes'}${$('#search').value ? ' found' : ''}` : 'Your notes live here';
  if (!snapshot) {
    const empty = el('div', 'mobile-connect');
    empty.innerHTML = '<div class="eyebrow">YOUR VAULTS, WITH YOU</div><h2>A quiet place for everything you know.</h2><p>Your GitHub notes, ready to read and search. No editing tools. No extra sync service.</p><button class="primary" data-connect>Connect GitHub <span>↗</span></button><button class="text-button" data-demo>Explore a sample library</button>';
    list.append(empty); connectionActions(empty);
    const desktop = el('div', 'empty-list empty-library-desktop'); desktop.innerHTML = '<strong>Four vaults. One search.</strong>Connect your repository to bring your notes here.'; list.append(desktop);
    return;
  }
  if (!notes.length) {
    const empty = el('div', 'empty-list'); empty.append(el('strong', '', 'Nothing here just yet.'), el('span', '', 'Try another word or choose All vaults. Search looks through titles and note contents.')); list.append(empty); return;
  }
  const fragment = document.createDocumentFragment();
  for (const note of notes) {
    const row = el('button', `note-row${selected === note.path ? ' selected' : ''}`); row.type = 'button'; row.dataset.path = note.path;
    if (selected === note.path) row.setAttribute('aria-current', 'page');
    const meta = el('span', 'row-meta'); meta.append(el('span', '', note.vault), el('span', 'row-arrow', '↗'));
    row.append(meta, el('h2', '', note.title), el('p', '', snippet(note, $('#search').value)));
    row.onclick = () => navigate(note.path);
    fragment.append(row);
  }
  list.append(fragment);
}
async function assetURL(path) {
  const assetEpoch = epoch;
  const file = snapshot?.files.find(f => f.path === path);
  if (!file) throw new Error('Attachment not found.');
  const ext = path.split('.').at(-1).toLowerCase();
  const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', pdf: 'application/pdf' }[ext];
  if (!mime) throw new Error('Only image and PDF attachments can be opened.');
  const key = `${snapshot.repo}:${file.sha}`;
  if (urls.has(key)) return urls.get(key);
  let blob = await readAsset(key);
  if (assetEpoch !== epoch) throw new Error('Connection changed.');
  if (!blob) {
    if (demo || !navigator.onLine || (config.authRequired && !token)) throw new Error('Connect to GitHub to load this attachment.');
    if (file.size > 20 * 1024 * 1024) throw new Error('Attachment exceeds the 20 MB download limit.');
    const generation = epoch;
    const data = await github(snapshot.repo, `git/blobs/${file.sha}`, token);
    if (generation !== epoch) throw new Error('Connection changed.');
    blob = new Blob([bytesFromBase64(data.content)], { type: mime });
    await writeAsset(key, blob);
  }
  if (assetEpoch !== epoch) throw new Error('Connection changed.');
  const url = URL.createObjectURL(blob); urls.set(key, url); return url;
}
function navigate(path, anchor = '') {
  const hash = `#note=${encodeURIComponent(path)}${anchor ? '&heading=' + encodeURIComponent(anchor) : ''}`;
  if (location.hash === hash) showNote(path, anchor); else location.hash = hash;
}
function scrollToAnchor(root, anchor) {
  if (!anchor) return;
  const heading = [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].find(h => fold(h.textContent).replace(/\s+/g, '-') === fold(anchor).replace(/\s+/g, '-') || fold(h.textContent) === fold(anchor));
  if (heading) heading.scrollIntoView({ block: 'start' });
  else toast('Heading not found in this note.');
}
async function showNote(path, anchor = '') {
  const note = snapshot?.notes.find(n => n.path === path);
  if (!note) { toast('That note is not in the saved library.'); return; }
  const version = ++renderVersion;
  selected = path; drawList(); $('.workspace').classList.add('note-open');
  const root = $('#reader-content'); root.replaceChildren();
  const nav = el('div', 'reader-nav');
  const back = el('button', 'back-button', '← Library'); back.type = 'button'; back.onclick = closeNote;
  nav.append(back, el('span', 'reader-breadcrumb', path), el('span', 'reading-label', 'Reading view'));
  const article = el('article', 'article');
  article.append(el('div', 'eyebrow', note.vault.toUpperCase()), el('h1', 'note-title', note.title));
  if (note.tags.length) { const tags = el('div', 'note-tags'); for (const tag of note.tags) tags.append(el('span', '', '#' + tag.replace(/^#/, ''))); article.append(tags); }
  const prose = el('div', 'prose');
  // Avoid repeating a leading title already shown above the article.
  const leading = note.body.match(/^\s*#\s+(.+)\r?\n/);
  const body = leading && leading[1].trim() === note.title ? note.body.slice(leading[0].length) : note.body;
  prose.innerHTML = renderMarkdown(body); article.append(prose);
  article.append(el('footer', 'article-footer', `${demo ? 'Sample library' : 'Saved from GitHub · ' + snapshot.commit.slice(0, 7)}\n${note.path}`));
  root.append(nav, article); $('#reader').scrollTop = 0;
  await decorate(prose, note, snapshot, assetURL);
  if (version !== renderVersion) return;
  scrollToAnchor(article, anchor);
}
function closeNote() {
  history.replaceState(null, '', location.pathname + location.search);
  selected = ''; renderVersion++; $('.workspace').classList.remove('note-open'); drawList(); welcome(); $('#search').focus({ preventScroll: true });
}
function route() {
  const p = new URLSearchParams(location.hash.slice(1));
  if (p.has('note') && snapshot) showNote(p.get('note'), p.get('heading') || '').catch(error => toast(error.message));
  else { selected = ''; $('.workspace').classList.remove('note-open'); drawList(); welcome(); }
}
async function refresh(nextConfig = config, nextToken = token, keepToken = remembered) {
  if (busy) return;
  busy = true; controller = new AbortController(); const generation = ++epoch;
  $('#refresh').disabled = true; $('#refresh').classList.add('spinning'); $('#connect-submit').disabled = true;
  $('#sync-status').textContent = 'Checking GitHub…'; $('#connection-error').hidden = true;
  try {
    const next = await fetchSnapshot(nextConfig, nextToken, demo ? null : snapshot, { signal: controller.signal, onProgress: (done, total) => { $('#sync-status').textContent = `Saving notes ${done} / ${total}…`; } });
    if (generation !== epoch) return;
    await saveConnection(next, nextConfig, keepToken ? nextToken : '');
    if (generation !== epoch) return;
    config = nextConfig; token = nextToken; remembered = keepToken; snapshot = next; demo = false; revokeAssets();
    $('#connection-dialog').close(); $('#token-input').value = '';
    filters(); drawList();
    if (selected && snapshot.notes.some(n => n.path === selected)) await showNote(selected);
    else { selected = ''; $('.workspace').classList.remove('note-open'); welcome(); }
    toast(`${snapshot.notes.length} notes ready to read offline.`);
    navigator.storage?.persist?.().catch(() => {});
  } catch (error) {
    controller?.abort();
    if (generation !== epoch || error.name === 'AbortError') return;
    const message = error instanceof TypeError ? 'Could not reach GitHub. Check your connection; saved notes are still available.' : error.message;
    $('#connection-error').textContent = message; $('#connection-error').hidden = false;
    toast(message, 12000);
  } finally {
    busy = false; $('#refresh').disabled = false; $('#refresh').classList.remove('spinning'); $('#connect-submit').disabled = false; status();
  }
}
function loadDemo() {
  if (busy) return;
  if (snapshot && !demo) { toast('Your library is already connected.'); return; }
  const samples = [
    ['personal/A little room to think.md', '---\ntitle: A little room to think\ntags: [ideas, everyday]\n---\n# A little room to think\n\nThe best notes are the ones you can find again. This is a **sample library**, not content from your repository.\n\n## Keep what matters\n\nA place for ideas, useful details, and the small things worth remembering.\n\n- One thought per note.\n- Links where they help.\n- Enough context for your future self.\n\n> You don’t need to remember everything. Just where to find it.\n\n## In this library\n\nTry searching for **lemon**, **walking**, or **offline**. Or follow [[A walking habit]] for another sample note.'],
    ['cooking/Lemon and herb pasta.md', '---\ntitle: Lemon & herb pasta\ntags: [quick, dinner]\n---\n# Lemon & herb pasta\n\nA bright, simple dinner for two. Ready in about 20 minutes.\n\n## Ingredients\n\n- 200 g pasta\n- 1 lemon, zest and juice\n- 2 tbsp olive oil\n- A handful of parsley\n- Parmesan, to finish\n\n## Method\n\n1. Cook the pasta in salted water. Save a mug of the cooking water.\n2. Warm the olive oil with lemon zest.\n3. Toss in the pasta, lemon juice, and a splash of cooking water.\n4. Finish with parsley and Parmesan.\n\n## Serve with\n\nSomething green and a little time away from your screen.'],
    ['personal/A walking habit.md', '# A walking habit\n\nA short walk is often enough to reset a busy day.\n\n## A simple routine\n\n1. Leave the phone in your pocket.\n2. Take the quieter route.\n3. Notice something you have not noticed before.\n\nBack to [[A little room to think]].'],
    ['work/Meeting notes that help.md', '# Meeting notes that help\n\nWrite down decisions, not a transcript.\n\n## A useful structure\n\n| Section | Keep it focused |\n| --- | --- |\n| Decision | What did we agree? |\n| Action | Who is doing what? |\n| Context | Why does it matter? |\n\nThe next person reading should know what changed.'],
    ['codex/Reading offline.md', '# Reading offline\n\nPocket Vault saves your downloaded notes in this browser. Search runs locally, so reading and finding notes work without a connection.\n\n## Refreshing\n\nOpen the app while online to check for the latest GitHub snapshot. Only changed notes need downloading. Images are cached when viewed.\n\n```text\nGitHub → saved snapshot → local search\n```\n\nThere are no editing controls and no repository write operations.']
  ];
  snapshot = { repo: 'sample/library', branch: '', commit: 'sample0', checkedAt: Date.now(), notes: samples.map(([p, b]) => parseNote(p, b)), files: samples.map(([path]) => ({ path })) };
  demo = true; filters(); drawList(); status(); welcome();
  if (matchMedia('(min-width: 761px)').matches) showNote(snapshot.notes[0].path);
}
$('#connection-form').addEventListener('submit', event => {
  event.preventDefault();
  try { const next = { repo: repository($('#repo-input').value), branch: $('#branch-input').value.trim(), authRequired: !!$('#token-input').value.trim() }; refresh(next, $('#token-input').value.trim(), $('#remember-token').checked); }
  catch (error) { $('#connection-error').textContent = error.message; $('#connection-error').hidden = false; }
});
$('#settings').onclick = openSettings;
$('#close-settings').onclick = () => { $('#connection-dialog').close(); $('#token-input').value = ''; };
$('#connection-dialog').addEventListener('cancel', () => { $('#token-input').value = ''; });
$('#refresh').onclick = () => { if (demo || !snapshot || (config.authRequired && !token)) openSettings(); else refresh(); };
$('#search').addEventListener('input', drawList);
$('.brand').onclick = event => { event.preventDefault(); closeNote(); };
$('#reader-content').addEventListener('click', async event => {
  const link = event.target.closest('a[data-path]'); if (!link) return;
  event.preventDefault(); const path = link.dataset.path;
  if (/\.md$/i.test(path)) navigate(path, link.dataset.anchor || '');
  else {
    // Open immediately from the user gesture to avoid popup blockers after async loading.
    const tab = window.open('about:blank', '_blank'); if (tab) tab.opener = null;
    try { const url = await assetURL(path); if (tab) tab.location.replace(url); else toast('Allow popups to open attachments.'); }
    catch (error) { tab?.close(); toast(error.message); }
  }
});
$('#forget').onclick = async () => {
  if (!confirm('Remove all saved notes, attachments, and the GitHub token from this browser? Your GitHub repository will not be changed.')) return;
  controller?.abort(); ++epoch; ++renderVersion;
  try {
    await clearAll(); revokeAssets(); token = ''; remembered = false; snapshot = null; demo = false; selected = ''; config = { repo: 'user/vault', branch: '' }; vault = 'all'; $('#search').value = ''; $('#token-input').value = '';
    $('#connection-dialog').close(); closeNote(); filters(); status(); toast('This device has been disconnected and cleared.');
  } catch (error) { toast(error.message); }
};
window.addEventListener('hashchange', route);
window.addEventListener('online', () => { status(); if ((!config.authRequired || token) && snapshot && !demo && !busy) refresh(); });
window.addEventListener('offline', status);
document.addEventListener('visibilitychange', () => { if (!document.hidden && (!config.authRequired || token) && snapshot && !demo && !busy && navigator.onLine && Date.now() - snapshot.checkedAt > 60 * 60 * 1000) refresh(); });
document.addEventListener('keydown', event => { if (event.key === '/' && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && !$('#connection-dialog').open) { event.preventDefault(); closeNote(); $('#search').focus(); } });
async function boot() {
  try {
    const [saved, settings, credential] = await Promise.all([read('snapshot'), read('config'), read('credential')]);
    snapshot = saved || null; if (settings) config = settings; token = credential || ''; remembered = !!credential;
    filters(); drawList(); welcome(); status(); route();
    if (snapshot && (!config.authRequired || token) && navigator.onLine) refresh();
  } catch (error) { filters(); drawList(); welcome(); toast(error.message, 12000); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => toast('Offline app installation is unavailable in this browser.'));
}
boot();
