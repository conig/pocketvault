// Base46's base_30 supplies UI colours; base_16 supplies Markdown/code syntax.
// Neovim-specific polish_hl groups are intentionally not interpreted.
export const DEFAULT_THEME = 'onedark';
const uiKeys=['black','darker_black','black2','white','line','one_bg','one_bg2','grey_fg','blue','green','red','yellow'];
export function validateCatalog({themes}) {
  if (!themes?.[DEFAULT_THEME]) throw new Error('Missing default base46 theme.');
  for (const [id,theme] of Object.entries(themes)) {
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || !['dark','light'].includes(theme.type)) throw new Error(`Invalid theme: ${id}`);
    for (const key of uiKeys) if (!theme.base_30?.[key]) throw new Error(`${id}: missing base_30.${key}`);
    for (let i=0;i<16;i++) if (!theme.base_16?.['base'+i.toString(16).toUpperCase().padStart(2,'0')]) throw new Error(`${id}: incomplete base_16`);
    for (const group of ['base_30','base_16']) for (const color of Object.values(theme[group])) {
      if (!/^#[\da-f]{6}$/i.test(color)) throw new Error(`${id}: invalid colour ${color}`);
    }
  }
}
export function themeVariables(theme) {
  const u=theme.base_30, s=theme.base_16;
  return {
    '--paper':u.black, '--surface':u.black, '--chrome':u.darker_black,
    '--panel':u.black2, '--ink':u.white, '--line':u.line,
    '--muted':'color-mix(in srgb, var(--ink) 72%, var(--paper))',
    '--accent':u.blue, '--accent-soft':u.one_bg, '--selection':u.one_bg2,
    '--success':u.green, '--error':u.red, '--warning':u.yellow,
    '--heading':s.base0D, '--strong':s.base0A, '--emphasis':s.base0E,
    '--code':s.base0B, '--link':s.base0C, '--comment':s.base03,
    '--number':s.base09, '--keyword':s.base0E, '--variable':s.base08,
  };
}
export function themeCSS(catalog) {
  validateCatalog(catalog);
  return Object.entries(catalog.themes).map(([id,theme])=>{
    const selector=(id===DEFAULT_THEME?':root,':'')+`:root[data-theme="${id}"]`;
    const vars={'--theme-id':id,'color-scheme':theme.type,...themeVariables(theme)};
    return `${selector}{${Object.entries(vars).map(([key,value])=>`${key}:${value}`).join(';')}}`;
  }).join('\n')+'\n';
}
