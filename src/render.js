import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import { resolveFile } from './core.js';
const md = new MarkdownIt({ html: false, linkify: true, breaks: false });
// Parse wiki syntax as inline tokens so code blocks, escaping, and labels stay safe.
md.inline.ruler.before('link', 'wiki', (state, silent) => {
  const match = state.src.slice(state.pos).match(/^(!?)\[\[([^\]\n]+)\]\]/);
  if (!match) return false;
  if (!silent) {
    const [target, label] = match[2].split('|');
    const token = state.push(match[1] ? 'wiki_embed' : 'wiki_link', '', 0);
    token.meta = { target, label: label || target.split('#')[0].split('/').at(-1).replace(/\.md$/i, '') || target };
  }
  state.pos += match[0].length;
  return true;
});
const esc = value => md.utils.escapeHtml(String(value));
md.renderer.rules.wiki_link = (tokens, i) => `<a href="#" data-wiki="${esc(tokens[i].meta.target)}">${esc(tokens[i].meta.label)}</a>`;
md.renderer.rules.wiki_embed = (tokens, i) => `<div class="embed-slot" data-embed="${esc(tokens[i].meta.target)}"></div>`;
export function renderMarkdown(body) {
  return DOMPurify.sanitize(md.render(body), { ADD_ATTR: ['data-wiki', 'data-embed'], FORBID_TAGS: ['style', 'iframe', 'form', 'input'], FORBID_ATTR: ['style'] });
}
export function sectionBody(body, anchor) {
  if (!anchor) return body;
  const lines = body.split('\n');
  if (anchor.startsWith('^')) {
    const index = lines.findIndex(line => line.trimEnd().endsWith(anchor));
    return index < 0 ? null : lines[index].replace(/\s+\^[\w-]+\s*$/, '');
  }
  const start = lines.findIndex(line => /^#{1,6}\s/.test(line) && line.replace(/^#+\s*/, '').trim().toLowerCase() === anchor.toLowerCase());
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(line));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}
export async function decorate(container, note, snapshot, assetURL, depth = 0, ancestors = []) {
  const files = snapshot.files;
  for (const a of container.querySelectorAll('a')) {
    const target = a.dataset.wiki ?? a.getAttribute('href');
    if (!target || /^(?:https?:|mailto:)/i.test(target)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; continue; }
    const resolved = resolveFile(target, note.path, files);
    if (resolved) { a.dataset.path = resolved.path; a.dataset.anchor = resolved.anchor; a.href = `#note=${encodeURIComponent(resolved.path)}${resolved.anchor ? '&heading=' + encodeURIComponent(resolved.anchor) : ''}`; }
    else { a.removeAttribute('href'); a.classList.add('unresolved'); a.title = 'This link is not available in the saved library.'; }
  }
  for (const img of container.querySelectorAll('img')) {
    const resolved = resolveFile(img.getAttribute('src') || '', note.path, files);
    img.removeAttribute('src'); // Never request remote images: note content cannot act as a tracking pixel.
    if (resolved) {
      try { img.src = await assetURL(resolved.path); img.loading = 'lazy'; } catch { const message = document.createElement('span'); message.className = 'attachment-note'; message.textContent = (img.alt || 'Image') + ' — connect to load'; img.replaceWith(message); }
    } else { const message = document.createElement('span'); message.className = 'attachment-note'; message.textContent = 'External image omitted for privacy.'; img.replaceWith(message); }
  }
  for (const slot of container.querySelectorAll('[data-embed]')) {
    const resolved = resolveFile(slot.dataset.embed, note.path, files);
    if (!resolved) { slot.textContent = `Embed unavailable: ${slot.dataset.embed}`; continue; }
    const embedded = snapshot.notes.find(n => n.path === resolved.path);
    if (embedded) {
      if (depth >= 3 || ancestors.includes(embedded.path) || embedded.path === note.path) { slot.textContent = 'Nested or circular embed omitted.'; continue; }
      const body = sectionBody(embedded.body, resolved.anchor);
      if (body === null) { slot.textContent = 'Embedded section not found.'; continue; }
      slot.classList.add('note-embed');
      const title = document.createElement('a'); title.textContent = embedded.title; title.dataset.path = embedded.path; title.href = `#note=${encodeURIComponent(embedded.path)}`; slot.append(title);
      const content = document.createElement('div'); content.innerHTML = renderMarkdown(body); slot.append(content);
      await decorate(content, embedded, snapshot, assetURL, depth + 1, [...ancestors, note.path]);
    } else if (/\.(png|jpe?g|webp|gif|avif)$/i.test(resolved.path)) {
      const img = document.createElement('img'); img.alt = resolved.path.split('/').at(-1); img.loading = 'lazy'; slot.append(img);
      try { img.src = await assetURL(resolved.path); } catch { slot.textContent = 'Image not cached. Connect and refresh to load it.'; }
    } else {
      const link = document.createElement('a'); link.textContent = `Open ${resolved.path.split('/').at(-1)}`; link.dataset.path = resolved.path; link.href = '#'; slot.append(link);
    }
  }
}
