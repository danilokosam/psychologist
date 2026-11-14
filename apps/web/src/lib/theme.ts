// Light / dark / system theme. Stored in localStorage (a pure UI preference,
// nothing the server needs) and applied as a class on <html>.

export type ThemeChoice = 'light' | 'dark' | 'system';
export const THEME_STORAGE_KEY = 'theme';

/**
 * Runs inline in <head> BEFORE first paint (see layout.tsx), so a dark-mode
 * user never sees a white flash. Kept tiny and dependency-free on purpose;
 * it must stay in sync with applyTheme below.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem('${THEME_STORAGE_KEY}');var d=c==='dark'||(c!=='light'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`;

export function readTheme(): ThemeChoice {
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored === 'light' || stored === 'dark' ? stored : 'system';
}

export function applyTheme(choice: ThemeChoice) {
  if (choice === 'system') window.localStorage.removeItem(THEME_STORAGE_KEY);
  else window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  const dark =
    choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}
