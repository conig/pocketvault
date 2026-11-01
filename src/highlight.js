import hljs from 'highlight.js/lib/core';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import r from 'highlight.js/lib/languages/r';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import sql from 'highlight.js/lib/languages/sql';
for (const [name, grammar] of Object.entries({javascript,python,r,bash,json,yaml,sql})) hljs.registerLanguage(name,grammar);
export function highlightCode(container) {
  for (const node of container.querySelectorAll('pre code')) {
    if (node.dataset.highlighted) continue;
    const language = [...node.classList].find(c=>c.startsWith('language-'))?.slice(9);
    if (language && hljs.getLanguage(language)) hljs.highlightElement(node);
  }
}
