import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import footnote from 'markdown-it-footnote';
import tasks from 'markdown-it-task-lists';
import mark from 'markdown-it-mark';
import { tex } from '@mdit/plugin-tex';
import { resolveFile, fold } from './core.js';
const md = new MarkdownIt({ html: true, linkify: true, breaks: false }).use(footnote).use(tasks).use(mark);
const escape = value => md.utils.escapeHtml(String(value));
md.use(tex, { delimiters: 'all', mathFence: true, render: (content, displayMode) => `<span class="math-source" data-tex="${escape(content)}" data-display="${!!displayMode}"></span>` });
md.block.ruler.before('paragraph', 'wiki_embed_block', (state, start, end, silent) => {
  const line = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
  const match = line.match(/^!\[\[([^\]]+)\]\]$/);
  if (!match) return false;
  if (!silent) { const token = state.push('wiki_embed', '', 0); token.meta = { target: match[1].split('|')[0] }; token.block = true; }
  state.line = start + 1; return true;
});
// Markdown table alignment is trusted parser output; use classes so raw HTML
// style attributes can remain forbidden without losing right/center alignment.
for (const type of ['th_open','td_open']) md.renderer.rules[type] = (tokens,i,options,env,self) => {
  const token = tokens[i], alignment = token.attrGet('style')?.match(/text-align:(left|center|right)/)?.[1];
  if (alignment) token.attrJoin('class','align-' + alignment);
  if (token.attrs) token.attrs = token.attrs.filter(([name]) => name !== 'style');
  return self.renderToken(tokens,i,options);
};
// Inline parsing leaves literal comment markers inside code untouched.
md.inline.ruler.before('escape', 'obsidian_comment', (state) => {
  if (!state.src.startsWith('%%', state.pos)) return false;
  const end = state.src.indexOf('%%', state.pos + 2); if (end < 0) return false;
  state.pos = end + 2; return true;
});
function resolveNote(target, from, snapshot) {
  const direct = resolveFile(target, from, snapshot.files); if (direct) return direct;
  const [name, anchor = ''] = target.split('#');
  const candidates = snapshot.notes.filter(n => [n.title, ...(n.aliases || [])].some(a => a.toLowerCase() === name.toLowerCase()));
  const same = candidates.filter(n => n.vault === from.split('/')[0]);
  const match = same.length === 1 ? same[0] : candidates.length === 1 ? candidates[0] : null;
  return match ? {path:match.path, anchor} : null;
}
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
md.renderer.rules.wiki_embed = (tokens, i) => `<${tokens[i].block ? 'div' : 'span'} class="embed-slot" data-embed="${esc(tokens[i].meta.target)}"></${tokens[i].block ? 'div' : 'span'}>`;
export function renderMarkdown(body) {
  const html = md.render(body);
  return DOMPurify.sanitize(html, { ADD_ATTR: ['data-wiki', 'data-embed', 'data-tex', 'data-display'], FORBID_TAGS: ['style', 'iframe', 'form', 'textarea', 'button'], FORBID_ATTR: ['style'], SANITIZE_NAMED_PROPS: true, USE_PROFILES: { html: true } });
}
export function sectionBody(body, anchor) {
  if (!anchor) return body;
  const lines = body.split('\n');
  if (anchor.startsWith('^')) {
    const index = lines.findIndex(line => line.trimEnd().endsWith(anchor));
    if (index < 0) return null;
    let start = index; while (start > 0 && lines[start-1].trim()) start--;
    return lines.slice(start,index+1).join('\n').replace(/\s*\^[\w-]+\s*$/, '');
  }
  const start = lines.findIndex(line => /^#{1,6}\s/.test(line) && line.replace(/^#+\s*/, '').trim().toLowerCase() === anchor.toLowerCase());
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}}\\s`).test(line));
  return lines.slice(start, end < 0 ? undefined : end).join('\n');
}
export async function decorate(container, note, snapshot, assetURL, depth = 0, ancestors = []) {
  for (const input of container.querySelectorAll('input')) {
    if (input.type !== 'checkbox' || !input.classList.contains('task-list-item-checkbox')) input.remove();
    else { input.disabled = true; input.tabIndex = -1; }
  }
  for (const quote of container.querySelectorAll('blockquote')) {
    const p = quote.firstElementChild;
    const match = p?.textContent.match(/^\[!([\w-]+)\]([+-])?[\t ]*([^\n]*)/);
    if (!match) continue;
    const callout = document.createElement(match[2] ? 'details' : 'aside'); callout.className = 'callout';
    if (match[2]) callout.open = match[2] !== '-';
    const title = document.createElement(match[2] ? 'summary' : 'strong'); title.className = 'callout-title'; title.textContent = match[3] || match[1];
    const remainder = p.textContent.slice(match[0].length).trim(); if (remainder) p.textContent = remainder; else p.remove();
    callout.append(title); while (quote.firstChild) callout.append(quote.firstChild); quote.replaceWith(callout);
  }
  const jobs = [];
  if (container.querySelector('.math-source')) jobs.push(import('./math.js').then(m => m.renderMath(container)));
  if (container.querySelector('pre code')) jobs.push(import('./highlight.js').then(m => m.highlightCode(container)));
  const files = snapshot.files;
  for (const a of container.querySelectorAll('a')) {
    if (a.dataset.tag) continue;
    const target = a.dataset.wiki ?? a.getAttribute('href');
    if (!target || /^(?:https?:|mailto:)/i.test(target)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; continue; }
    if (target.startsWith('#') && !a.dataset.wiki) {
      const id = decodeURIComponent(target.slice(1));
      const match = [...container.querySelectorAll('[id]')].find(n => n.id === id || n.id === 'user-content-' + id);
      if (match) { a.dataset.localAnchor = match.id; a.href = '#' + match.id; continue; }
    }
    const resolved = resolveNote(target, note.path, snapshot);
    if (resolved) { a.dataset.path = resolved.path; a.dataset.anchor = resolved.anchor; a.href = `#note=${encodeURIComponent(resolved.path)}${resolved.anchor ? '&heading=' + encodeURIComponent(resolved.anchor) : ''}`; }
    else {
      // An anchor without href is still a qutebrowser "all" hint target.
      // Unavailable references are text, not dead interactive controls.
      const text = document.createElement('span'); text.className = 'unresolved';
      text.title = 'This link is not available in the saved library.';
      text.append(...a.childNodes); a.replaceWith(text);
    }
  }
  for (const img of container.querySelectorAll('img')) {
    const resolved = resolveFile(img.getAttribute('src') || '', note.path, files);
    img.removeAttribute('src'); // Never request remote images: note content cannot act as a tracking pixel.
    if (resolved) {
      try { img.src = await assetURL(resolved.path); img.loading = 'lazy'; } catch { const message = document.createElement('span'); message.className = 'attachment-note'; message.textContent = (img.alt || 'Image') + ' — connect to load'; img.replaceWith(message); }
    } else { const message = document.createElement('span'); message.className = 'attachment-note'; message.textContent = 'External image omitted for privacy.'; img.replaceWith(message); }
  }
  for (const slot of container.querySelectorAll('[data-embed]')) {
    const resolved = resolveNote(slot.dataset.embed.split('|')[0], note.path, snapshot);
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
  await Promise.all(jobs);
}

// Source-first reader: parser tokens colour syntax without typesetting the note.
// All raw HTML stays escaped. Destinations are concealed, not evaluated.
const sourceMD = new MarkdownIt({html:false, linkify:false, breaks:false});
sourceMD.inline.ruler.before('link', 'wiki', ((state, silent) => {
  const match = state.src.slice(state.pos).match(/^(!?)\[\[([^\]\n]+)\]\]/);
  if (!match) return false;
  if (!silent) { const [target,label] = match[2].split('|'); const t=state.push('wiki_link','',0); t.meta={target,label:label || target.split('/').at(-1).replace(/\.md$/i,'')}; }
  state.pos += match[0].length; return true;
}));
sourceMD.renderer.rules.wiki_link = md.renderer.rules.wiki_link;
for (const type of ['strong','em','s']) for (const side of ['open','close']) sourceMD.renderer.rules[type+'_'+side] = (tokens,i) => side==='open' ? `<span class="syntax-${type}">${escape(tokens[i].markup)}` : `${escape(tokens[i].markup)}</span>`;
sourceMD.renderer.rules.code_inline = (tokens,i) => `<span class="syntax-code">${escape(tokens[i].markup+tokens[i].content+tokens[i].markup)}</span>`;
sourceMD.renderer.rules.image = (tokens,i) => `<a href="${escape(tokens[i].attrGet('src') || '')}">![${escape(tokens[i].content)}]</a>`;
sourceMD.renderer.rules.softbreak = () => '\n';
sourceMD.renderer.rules.hardbreak = () => '  \n';
// Work on parser tokens, not HTML: never nest links or activate hashtags in
// code, escaped text, destinations or wiki labels. Backticks are tag notation
// only on an explicit Tags: line.
sourceMD.core.ruler.after('inline', 'tag_links', state => {
  const tags = state.env.tags;
  if (!tags?.size) return;
  for (const block of state.tokens) {
    if (!block.children) continue;
    const children = []; let linkDepth = 0;
    const text = content => { const t = new state.Token('text', '', 0); t.content = content; return t; };
    const link = (content, tag) => { const t = new state.Token('tag_link', '', 0); t.content = content; t.meta = { tag }; return t; };
    for (const token of block.children) {
      if (token.type === 'link_open') linkDepth++;
      if (!linkDepth && state.env.tagLine && token.type === 'code_inline' && tags.has(fold(token.content.replace(/^#/, '')))) {
        children.push(link(token.markup + token.content + token.markup, tags.get(fold(token.content.replace(/^#/, '')))));
      } else if (!linkDepth && token.type === 'text') {
        const pattern = state.env.tagLine
          ? /(^|[\s,\[\]])(#?[\p{L}\p{N}_/-]+)(?=$|[\s,\[\]])/gu
          : /(^|\s)(#[\p{L}_][\p{L}\p{N}_/-]*)/gu;
        let start = 0;
        for (const match of token.content.matchAll(pattern)) {
          const tag = tags.get(fold(match[2].replace(/^#/, '')));
          if (!tag) continue;
          const index = match.index + match[1].length;
          children.push(text(token.content.slice(start, index)), link(match[2], tag));
          start = index + match[2].length;
        }
        children.push(text(token.content.slice(start)));
      } else children.push(token);
      if (token.type === 'link_close') linkDepth--;
    }
    block.children = children;
  }
});
sourceMD.renderer.rules.tag_link = (tokens, i) => {
  const { tag } = tokens[i].meta;
  return `<a class="tag-link" href="#tag=${encodeURIComponent(tag)}" data-tag="${escape(tag)}">${escape(tokens[i].content)}</a>`;
};
export function renderSource(body, noteTags = []) {
  const tags = new Map(noteTags.map(tag => [fold(tag), tag]));
  const lines=body.split('\n'), styles=new Map(), literal=new Set(), headings=new Map();
  for (const t of sourceMD.parse(body,{})) {
    if (!t.map) continue;
    const [start,end]=t.map;
    if (t.type==='heading_open') headings.set(start, Number(t.tag.slice(1)));
    if (['fence','code_block','html_block'].includes(t.type)) for(let i=start;i<end;i++) literal.add(i);
    const style=t.type==='heading_open' ? 'heading' : t.type==='fence'||t.type==='code_block' ? 'code' : t.type==='blockquote_open' ? 'quote' : t.type==='hr' ? 'rule' : '';
    if(style) for(let i=start;i<end;i++) styles.set(i,style);
  }
  return lines.map((line,i)=>{
    const kind=styles.get(i)||'';
    const heading=kind==='heading' ? ` data-heading="${escape(line.replace(/^\s*#+\s*/, '').replace(/\s+#+\s*$/, ''))}"${headings.has(i) ? ` role="heading" aria-level="${headings.get(i)}"` : ''}` : '';
    return `<div class="source-line syntax-${kind}"${heading}><span class="line-number" aria-hidden="true">${i+1}</span><span class="line-text">${literal.has(i)?escape(line):sourceMD.renderInline(line, { tags, tagLine: /^Tags:\s*\S/i.test(line) })}</span></div>`;
  }).join('');
}
