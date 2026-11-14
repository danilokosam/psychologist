import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AccountPanel } from '@/components/account-panel';
import { ui } from '@/lib/ui';

const SHORTCUTS = [
  { href: '/patients', key: 'patients', icon: 'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1m14-9a3 3 0 1 0 0-6m6 15v-1a4 4 0 0 0-3-3.9M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z' },
  { href: '/appointments', key: 'calendar', icon: 'M8 3v3m8-3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z' },
] as const;

/**
 * The signed-in home. Practice metrics arrive with Milestone 5; for now it
 * offers the two working areas and the account/practice panel. What it also
 * proves is the full chain: a session, a verified token reaching the API,
 * the account bootstrapped in Postgres, the organization read back via RLS.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');

  return (
    <main className={`${ui.page} max-w-4xl`}>
      <div className="space-y-1">
        <h1 className={ui.h1}>{t('title')}</h1>
        <p className={ui.muted}>{t('emptyState')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {SHORTCUTS.map((shortcut) => (
          <Link
            key={shortcut.href}
            href={shortcut.href}
            className="group flex items-center gap-4 rounded-xl border border-border bg-surface p-5 shadow-sm transition-colors duration-150 hover:border-primary hover:bg-primary-soft"
          >
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground">
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d={shortcut.icon} />
              </svg>
            </span>
            <span className="space-y-0.5">
              <span className="block font-semibold text-foreground">{t(`${shortcut.key}Link`)}</span>
              <span className="block text-sm text-muted">{t(`${shortcut.key}Hint`)}</span>
            </span>
          </Link>
        ))}
      </div>

      <AccountPanel />
    </main>
  );
}
