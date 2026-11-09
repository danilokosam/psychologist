import { useTranslations } from 'next-intl';
import { AccountPanel } from '@/components/account-panel';

/**
 * The empty dashboard Milestone 0's definition of done asks for.
 *
 * It has no practice data on it yet, because patients, appointments and
 * sessions don't exist until later milestones. What it does prove is the full
 * chain: an authenticated session, a verified token reaching the API, the
 * account bootstrapped in Postgres, and the caller's own organization read
 * back through RLS.
 */
export default function DashboardPage() {
  const t = useTranslations('dashboard');

  return (
    <main className="flex-1 bg-zinc-50 p-6 dark:bg-black">
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            {t('title')}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('emptyState')}</p>
        </div>
        <AccountPanel />
      </div>
    </main>
  );
}
