import katex from 'katex';
export function renderMath(container) {
  for (const node of container.querySelectorAll('.math-source')) {
    katex.render(node.dataset.tex, node, { displayMode: node.dataset.display === 'true', throwOnError: false, trust: false, strict: 'warn', maxExpand: 1000, maxSize: 10, output: 'htmlAndMathml' });
    node.removeAttribute('data-tex');
  }
}
