'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PatientsList } from '@/components/patients/patients-list';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';

export default function PatientsPage() {
  const t = useTranslations('patients');

  return (
    <main className="flex-1 bg-zinc-50 p-6 dark:bg-black">
      <div className="mx-auto max-w-3xl space-y-4">
        <Link href="/dashboard" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          {t('backToDashboard')}
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">{t('title')}</h1>
          <Link
            href="/patients/new"
            className="rounded bg-black px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
          >
            {t('new')}
          </Link>
        </div>
        <WithActiveOrganization>
          {(active) => <PatientsList key={active.organizationId} organizationId={active.organizationId} />}
        </WithActiveOrganization>
      </div>
    </main>
  );
}
