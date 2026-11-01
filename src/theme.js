import {DEFAULT_THEME} from './theme-palette.js';
export const THEME_KEY = 'pocket-vault-theme';
export function currentTheme() {
  return document.documentElement.dataset.theme || DEFAULT_THEME;
}
export function applyTheme(id = DEFAULT_THEME) {
  const root=document.documentElement;
  root.dataset.theme=id;
  // CSS is the registry: unknown/removed IDs fall back to the default palette.
  if (getComputedStyle(root).getPropertyValue('--theme-id').trim() !== id) root.dataset.theme=DEFAULT_THEME;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',getComputedStyle(root).getPropertyValue('--paper').trim());
  return currentTheme();
}
export function restoreTheme() {
  let id=DEFAULT_THEME;
  try { id=localStorage.getItem(THEME_KEY) || DEFAULT_THEME; } catch { /* Storage may be disabled. Keep the default usable. */ }
  return applyTheme(id);
}
export function saveTheme(id) {
  const previous=currentTheme(), next=applyTheme(id);
  try { localStorage.setItem(THEME_KEY,next); }
  catch { applyTheme(previous); throw new Error('Could not save the theme. Allow browser storage and try again; your previous theme is unchanged.'); }
  return next;
}
export function forgetTheme() {
  try { localStorage.removeItem(THEME_KEY); }
  finally { applyTheme(DEFAULT_THEME); }
}
