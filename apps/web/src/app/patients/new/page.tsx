'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NewPatient } from '@/components/patients/new-patient';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { ui } from '@/lib/ui';

export default function NewPatientPage() {
  const t = useTranslations('patients');

  return (
    <main className={`${ui.page} max-w-2xl`}>
      <div className="space-y-4">
        <Link href="/patients" className="text-sm font-medium text-muted transition-colors duration-150 hover:text-foreground">
          {t('backToList')}
        </Link>
        <h1 className={ui.h1}>{t('new')}</h1>
        <WithActiveOrganization>
          {(active) => <NewPatient organizationId={active.organizationId} />}
        </WithActiveOrganization>
      </div>
    </main>
  );
}
