'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useActiveOrganization, type ActiveOrganization } from '@/lib/use-active-organization';
import { ui } from '@/lib/ui';
import { Spinner } from '../ui/feedback';

/** Resolves the active organization, then renders `children` with it. */
export function WithActiveOrganization({ children }: { children: (active: ActiveOrganization) => React.ReactNode }) {
  const t = useTranslations('patients');
  const state = useActiveOrganization();

  if (state.kind === 'loading') return <Spinner label={t('loading')} />;
  if (state.kind === 'ready') {
    return (
      <>
        <p className="text-sm text-muted">{t('inPractice', { name: state.active.name })}</p>
        {children(state.active)}
      </>
    );
  }
  return (
    <p className="text-sm text-muted">
      {state.kind === 'error' ? t('loadFailed') : t('noPractice')}{' '}
      <Link href="/dashboard" className={ui.link}>
        {t('backToDashboard')}
      </Link>
    </p>
  );
}
