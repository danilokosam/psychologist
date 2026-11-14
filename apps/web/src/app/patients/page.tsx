'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PatientsList } from '@/components/patients/patients-list';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { ui } from '@/lib/ui';

export default function PatientsPage() {
  const t = useTranslations('patients');

  return (
    <main className={`${ui.page} max-w-4xl`}>
      <div className="flex items-center justify-between gap-4">
        <h1 className={ui.h1}>{t('title')}</h1>
        <Link href="/patients/new" className={ui.button.primary}>
          + {t('new')}
        </Link>
      </div>
      <div className="space-y-4">
        <WithActiveOrganization>
          {(active) => <PatientsList key={active.organizationId} organizationId={active.organizationId} />}
        </WithActiveOrganization>
      </div>
    </main>
  );
}
