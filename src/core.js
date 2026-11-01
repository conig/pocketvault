import { parse } from 'yaml';
export const VAULTS = ['work', 'personal', 'cooking', 'codex'];
// Missing selection means all vaults for snapshots created before this setting.
export function selectedVaults(selection) {
  if (selection === undefined) return [...VAULTS];
  if (!Array.isArray(selection) || selection.some(v => !VAULTS.includes(v))) throw new Error('Choose from work, personal, cooking, and codex.');
  const chosen = VAULTS.filter(v => selection.includes(v));
  if (!chosen.length) throw new Error('Select at least one vault.');
  return chosen;
}
export function selectSavedVaults(snapshot, selection) {
  const vaults = selectedVaults(selection);
  const saved = selectedVaults(snapshot.vaults);
  if (vaults.some(v => !saved.includes(v))) throw new Error('Connect to GitHub to download newly selected vaults.');
  const include = path => vaults.includes(path.split('/')[0]);
  return { ...snapshot, vaults, vaultCounts: snapshot.vaultCounts || countVaults(snapshot.files), notes: snapshot.notes.filter(n => include(n.path)), files: snapshot.files.filter(f => include(f.path)) };
}
export function countVaults(files) {
  return Object.fromEntries(VAULTS.map(v => [v, files.filter(f => f.path.startsWith(v + '/') && /\.md$/i.test(f.path)).length]));
}
export const fold = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
export function repository(value) {
  const text = value.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(text)) throw new Error('Use a GitHub repository in owner/name format.');
  return text;
}
export function allowedPath(path) {
  const parts = path.split('/');
  return VAULTS.includes(parts[0]) && parts.length > 1 && parts.every(p => p && p !== '..' && !p.startsWith('.'));
}
export const NOTE_FORMAT = 3;
function timestamp(value) {
  const time = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) && time > 0 ? time : 0;
}
const firstTimestamp = (...values) => values.map(timestamp).find(Boolean) || 0;
const cleanTitle = value => String(value || '').replace(/^(?:\d{10,13}|\d{4}-\d{2}-\d{2})[-_\s]+/, '').replace(/[_]+/g, ' ').replace(/[*`]/g, '').trim();
export function parseNote(path, raw, sha = '') {
  let body = raw.replace(/^\uFEFF/, ''), meta = {};
  const front = body.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (front) {
    try { const data = parse(front[1], { maxAliasCount: 20 }); if (data && typeof data === 'object') meta = data; } catch { /* Malformed frontmatter stays visible. */ }
    if (Object.keys(meta).length) body = body.slice(front[0].length);
  }
  const filename = path.split('/').at(-1).replace(/\.md$/i, '');
  const aliases = (Array.isArray(meta.aliases) ? meta.aliases : [meta.aliases]).filter(v => typeof v === 'string' && v.trim());
  const heading = body.match(/^#\s+(.+)$/m)?.[1] || '';
  const explicit = typeof meta.title === 'string' && !/^\d{10,13}(?:[-_]|$)/.test(meta.title) ? meta.title : typeof meta.recipe_title === 'string' ? meta.recipe_title : '';
  const humanHeading = heading === filename || /^\d{10,13}[-_]/.test(heading) ? '' : heading;
  const title = cleanTitle(explicit || aliases[0] || humanHeading) || cleanTitle(filename).replace(/-/g, ' ') || 'Untitled note';
  const withoutCode = body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, '').replace(/`[^`\n]+`/g, '');
  const yamlTags = Array.isArray(meta.tags) ? meta.tags : typeof meta.tags === 'string' ? meta.tags.split(/[,\s]+/) : [];
  const plainTags = [...body.matchAll(/^Tags:\s*(.+)$/gmi)].flatMap(m => m[1].replace(/[`\[\]]/g, '').split(/[,\s]+/));
  const inlineTags = [...withoutCode.matchAll(/(?:^|\s)#([\p{L}_][\p{L}\p{N}_/-]*)/gu)].map(m => m[1]);
  const unique = new Map();
  for (const rawTag of [...yamlTags, ...plainTags, ...inlineTags]) if (typeof rawTag === 'string') {
    const tag = rawTag.trim().replace(/^#/, ''); if (tag && !unique.has(fold(tag))) unique.set(fold(tag), tag);
  }
  const tags = [...unique.values()];
  const dateValue = meta.updated || meta.modified || meta.date || meta.created || body.match(/^Date:\s*(\d{4}-\d{2}-\d{2})/mi)?.[1] || filename.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  const date = dateValue ? String(dateValue).slice(0, 10) : '';
  const modifiedAt = firstTimestamp(meta.modified, meta.updated, meta.modified_at, meta.updated_at, meta.modifiedAt, meta.updatedAt);
  const createdAt = firstTimestamp(meta.created, meta.created_at, meta.createdAt, meta.date,
    body.match(/^Date:\s*(\d{4}-\d{2}-\d{2})/mi)?.[1], filename.match(/^\d{4}-\d{2}-\d{2}/)?.[0],
    Number(filename.match(/^(\d{10}|\d{13})(?:[-_\s]|$)/)?.[1]));
  const facts = [['serves','Serves'], ['prep','Prep'], ['cook','Cook'], ['rating','Rating']].filter(([key]) => ['string','number'].includes(typeof meta[key])).map(([key,label]) => ({label, value: String(meta[key])}));
  const plain = body.replace(/^#\s+.+$/m, '').replace(/```[\s\S]*?```/g, ' ').replace(/!?(?:\[\[([^\]]+)\]\])/g, '$1').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/^Tags:.*$/gmi, '').replace(/[#*_`>|~]/g, '').replace(/\s+/g, ' ').trim();
  const words = plain.split(/\s+/).filter(Boolean).length;
  return { path, sha, vault: path.split('/')[0], title, aliases, body, tags, date, modifiedAt, createdAt, facts, words, minutes: Math.max(1, Math.ceil(words / 220)), plain, search: fold(title + ' ' + aliases.join(' ') + ' ' + path + ' ' + tags.join(' ') + ' ' + body), formatVersion: NOTE_FORMAT };
}
// Old snapshots stay immediately readable; only a background sync recovers
// frontmatter fields absent from old caches. Never delay launch for migration.
export function cachedNote(note) {
  if (note.formatVersion === NOTE_FORMAT) return note;
  const parsed = parseNote(note.path, note.body, note.sha);
  const title = /^\d{10,13}[-_]/.test(note.title || '') ? cleanTitle(note.title).replace(/-/g, ' ') : cleanTitle(note.title) || parsed.title;
  const tags = [...new Set([...(note.tags || []), ...parsed.tags])];
  const aliases = note.aliases || parsed.aliases;
  return { ...parsed, ...note, date: note.date || parsed.date, modifiedAt: note.modifiedAt || parsed.modifiedAt, createdAt: note.createdAt || timestamp(note.date) || parsed.createdAt, title, tags, aliases, search: fold(title + ' ' + aliases.join(' ') + ' ' + note.path + ' ' + tags.join(' ') + ' ' + note.body), formatVersion: note.formatVersion || 0 };
}
export function searchNotes(notes, query, vault = 'all', tag = '', accessTimes = new Map()) {
  const terms = [...fold(query).matchAll(/"([^"]+)"|(\S+)/g)].map(m => m[1] || m[2]);
  const tagMatch = (n, t) => n.tags.some(v => fold(v) === fold(t) || fold(v).startsWith(fold(t) + '/'));
  const rows = notes.filter(n => (vault === 'all' || n.vault === vault) && (!tag || tagMatch(n, tag)) && terms.every(t => t.startsWith('#') ? tagMatch(n, t.slice(1)) : n.search.includes(t)));
  // Access wins when available; unopened notes use their own metadata, never
  // the download time. Keep full precision and deterministic ties.
  const recent = n => accessTimes.get(n.path) || n.modifiedAt || n.createdAt || timestamp(n.date);
  const byRecency = (a,b) => recent(b)-recent(a) || (b.modifiedAt || 0)-(a.modifiedAt || 0) || (b.createdAt || 0)-(a.createdAt || 0) || a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
  if (!terms.length) return rows.sort(byRecency);
  return rows.map(note => ({ note, score: terms.reduce((s,t) => s + (fold(note.title).includes(t) ? 10 : 0) + (tagMatch(note,t.replace(/^#/,'')) ? 3 : 0),0) })).sort((a,b) => b.score-a.score || byRecency(a.note,b.note)).map(r=>r.note);
}
export function snippet(note, query) {
  const term = fold(query).match(/"([^"]+)"|(\S+)/)?.[0]?.replaceAll('"', '') || '';
  const start = term ? Math.max(0, fold(note.plain).indexOf(term) - 45) : 0;
  return (start ? '…' : '') + note.plain.slice(start, start + 160) + (note.plain.length > start + 160 ? '…' : '');
}
export function normalizePath(path) {
  const parts = [];
  for (const part of path.split('/')) { if (part === '..') parts.pop(); else if (part && part !== '.') parts.push(part); }
  return parts.join('/');
}
export function resolveFile(target, from, files) {
  let decoded;
  try { decoded = decodeURIComponent(target); } catch { return null; }
  const [name, anchor = ''] = decoded.split('#');
  if (!name) return { path: from, anchor };
  const candidates = [normalizePath(from.slice(0, from.lastIndexOf('/') + 1) + name), normalizePath(name), from.split('/')[0] + '/' + name];
  for (const c of candidates) for (const p of [c, c + '.md']) if (files.some(f => f.path === p)) return { path: p, anchor };
  const base = fold(name.replace(/\.md$/i, ''));
  const matches = files.filter(f => fold(f.path.replace(/\.md$/i, '')).endsWith('/' + base));
  const sameVault = matches.filter(f => f.path.split('/')[0] === from.split('/')[0]);
  const match = sameVault.length === 1 ? sameVault[0] : matches.length === 1 ? matches[0] : null;
  return match ? { path: match.path, anchor } : null;
}
export function bytesFromBase64(content) { return Uint8Array.from(atob(content.replace(/\s/g, '')), c => c.charCodeAt(0)); }
export function github(repo, endpoint, token, options) {
  return githubRequest(`repos/${repo}/${endpoint}`, token, options);
}
export async function githubRequest(path, token, { signal, fetcher = fetch } = {}) {
  const res = await fetcher(`https://api.github.com/${path}`, {
    method: 'GET', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal,
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('GitHub rejected the token. Check its value and expiry.');
    if (res.status === 404) throw new Error('Repository or branch not found. Check the name and token access.');
    if (res.status === 403 || res.status === 429) throw new Error('GitHub denied access or rate-limited this request. Check Contents: read permission, or try again later.');
    throw new Error(`GitHub request failed (${res.status}). Your saved library is unchanged.`);
  }
  return res.json();
}
export async function fetchSnapshot(config, token, previous, { signal, fetcher, onProgress = () => {} } = {}) {
  const repo = repository(config.repo);
  const vaults = selectedVaults(config.vaults);
  const get = endpoint => github(repo, endpoint, token, { signal, fetcher });
  const commits = await get(config.branch ? `commits/${encodeURIComponent(config.branch)}` : 'commits?per_page=1');
  const commit = Array.isArray(commits) ? commits[0] : commits;
  if (!commit?.sha || !commit?.commit?.tree?.sha) throw new Error('This repository has no readable commits.');
  const sameSource = previous?.repo === repo && previous?.branch === config.branch;
  const sameCommit = sameSource && commit.sha === previous.commit;
  const sameSelection = sameSource && JSON.stringify(vaults) === JSON.stringify(selectedVaults(previous.vaults));
  if (sameCommit && sameSelection && previous.notes.every(n => n.formatVersion === NOTE_FORMAT)) return { ...previous, vaults, checkedAt: Date.now() };
  // Re-read the pinned tree when the selection changes, even on the same
  // commit. Persist counts only, never excluded note names or their content.
  const tree = await get(`git/trees/${commit.commit.tree.sha}?recursive=1`);
  if (tree.truncated) throw new Error('GitHub returned an incomplete file listing. Saved notes have not been replaced.');
  const catalog = tree.tree.filter(f => f.type === 'blob' && f.mode !== '120000' && allowedPath(f.path));
  if (!catalog.some(f => /\.md$/i.test(f.path))) throw new Error('No Markdown notes found in work, personal, cooking, or codex.');
  const files = catalog.filter(f => vaults.includes(f.path.split('/')[0]));
  const markdown = files.filter(f => /\.md$/i.test(f.path));
  const old = new Map((sameSource ? previous.notes : []).map(n => [n.path, n]));
  const notes = new Array(markdown.length); let next = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(3, markdown.length) }, async () => {
    while (next < markdown.length) {
      signal?.throwIfAborted();
      const i = next++, f = markdown[i], cached = old.get(f.path);
      if (cached?.sha === f.sha && cached.formatVersion === NOTE_FORMAT) notes[i] = cached;
      else {
        if (f.size > 2 * 1024 * 1024) throw new Error(`A note exceeds the 2 MB limit: ${f.path}`);
        const blob = await get(`git/blobs/${f.sha}`);
        if (blob.encoding !== 'base64') throw new Error('GitHub returned an unsupported file encoding.');
        notes[i] = parseNote(f.path, new TextDecoder().decode(bytesFromBase64(blob.content)), f.sha);
      }
      onProgress(++done, markdown.length);
    }
  }));
  return { repo, branch: config.branch, vaults, commit: commit.sha, checkedAt: Date.now(), savedAt: Date.now(), notes, files, vaultCounts: countVaults(catalog) };
}
