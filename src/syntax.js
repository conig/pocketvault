import {Parser, Language} from 'web-tree-sitter';
let ready;
function parser() {
  return ready ||= (async()=>{await Parser.init({locateFile:()=>'/parsers/web-tree-sitter.wasm'});const p=new Parser();p.setLanguage(await Language.load('/parsers/markdown.wasm'));return p;})().catch(error=>{ready=null;throw error;});
}
export async function highlightSource(container, body) {
  const p=await parser();
  if (!container.isConnected) return;
  const tree=p.parse(body); if(!tree) return;
  try {
    const lines=container.querySelectorAll('.source-line');
    function visit(node) {
      const kind=({atx_heading:'heading',setext_heading:'heading',fenced_code_block:'code',indented_code_block:'code',block_quote:'quote',thematic_break:'rule',list_marker_minus:'marker',list_marker_plus:'marker',list_marker_star:'marker'})[node.type];
      if(kind) {
        const end=node.endPosition.row+(node.endPosition.column>0?1:0);
        for(let i=node.startPosition.row;i<end;i++) lines[i]?.classList.add('syntax-'+kind);
      }
      for(const child of node.namedChildren) visit(child);
    }
    visit(tree.rootNode); container.dataset.syntaxEngine='tree-sitter';
  } finally {tree.delete();}
}
