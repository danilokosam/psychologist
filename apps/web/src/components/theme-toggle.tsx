'use client';

import { useSyncExternalStore } from 'react';
import { useTranslations } from 'next-intl';
import { applyTheme, readTheme, type ThemeChoice } from '@/lib/theme';

const EVENT = 'themechange';

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener('storage', callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener('storage', callback);
  };
}

const ICONS: Record<ThemeChoice, React.ReactNode> = {
  light: (
    <path d="M12 3v2m0 14v2M5.6 5.6l1.4 1.4m10 10 1.4 1.4M3 12h2m14 0h2M5.6 18.4 7 17m10-10 1.4-1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" />
  ),
  dark: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />,
  system: <path d="M4 5h16v11H4zM8 20h8m-4-4v4" />,
};

/** Light / dark / follow the system. Remembered per browser. */
export function ThemeToggle() {
  const t = useTranslations('theme');
  // The server can't know the choice; it renders "system" and the client
  // corrects it after hydration without a mismatch warning.
  const choice = useSyncExternalStore(subscribe, readTheme, () => 'system' as const);

  function choose(next: ThemeChoice) {
    applyTheme(next);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <div role="group" aria-label={t('label')} className="flex rounded-lg border border-border bg-surface-muted p-0.5">
      {(['light', 'dark', 'system'] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={choice === option}
          title={t(option)}
          onClick={() => choose(option)}
          className={`rounded-md p-1.5 transition-colors duration-150 ${
            choice === option ? 'bg-surface text-primary shadow-sm' : 'text-muted hover:text-foreground'
          }`}
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICONS[option]}
          </svg>
          <span className="sr-only">{t(option)}</span>
        </button>
      ))}
    </div>
  );
}
