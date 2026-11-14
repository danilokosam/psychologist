'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { NewPatient } from '@/components/patients/new-patient';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';

export default function NewPatientPage() {
  const t = useTranslations('patients');

  return (
    <main className="flex-1 bg-zinc-50 p-6 dark:bg-black">
      <div className="mx-auto max-w-xl space-y-4">
        <Link href="/patients" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          {t('backToList')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">{t('new')}</h1>
        <WithActiveOrganization>
          {(active) => <NewPatient organizationId={active.organizationId} />}
        </WithActiveOrganization>
      </div>
    </main>
  );
}
