'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActiveOrganization, type ActiveOrganization } from '@/lib/use-active-organization';

/** Resolves the active organization, then renders `children` with it. */
export function WithActiveOrganization({ children }: { children: (active: ActiveOrganization) => React.ReactNode }) {
  const t = useTranslations('patients');
  const state = useActiveOrganization();

  if (state.kind === 'loading') return <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('loading')}</p>;
  if (state.kind === 'ready') {
    return (
      <>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{t('inPractice', { name: state.active.name })}</p>
        {children(state.active)}
      </>
    );
  }
  return (
    <p className="text-sm text-zinc-600 dark:text-zinc-400">
      {state.kind === 'error' ? t('loadFailed') : t('noPractice')}{' '}
      <Link href="/dashboard" className="underline">
        {t('backToDashboard')}
      </Link>
    </p>
  );
}
