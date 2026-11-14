'use client';

import { use } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PatientDetail } from '@/components/patients/patient-detail';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';

export default function PatientPage({ params }: PageProps<'/patients/[patientId]'>) {
  const t = useTranslations('patients');
  const { patientId } = use(params);

  return (
    <main className="flex-1 bg-zinc-50 p-6 dark:bg-black">
      <div className="mx-auto max-w-xl space-y-4">
        <Link href="/patients" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          {t('backToList')}
        </Link>
        <WithActiveOrganization>
          {(active) => (
            <PatientDetail
              key={`${active.organizationId}:${patientId}`}
              organizationId={active.organizationId}
              role={active.role}
              patientId={patientId}
            />
          )}
        </WithActiveOrganization>
      </div>
    </main>
  );
}
