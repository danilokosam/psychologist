'use client';

import { use } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { PatientDetail } from '@/components/patients/patient-detail';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { ui } from '@/lib/ui';

export default function PatientPage({ params }: PageProps<'/patients/[patientId]'>) {
  const t = useTranslations('patients');
  const { patientId } = use(params);

  return (
    <main className={`${ui.page} max-w-3xl`}>
      <div className="space-y-4">
        <Link href="/patients" className="text-sm font-medium text-muted transition-colors duration-150 hover:text-foreground">
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
