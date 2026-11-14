'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { RecordSession } from '@/components/clinical/record-session';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { Alert } from '@/components/ui/feedback';
import { ui } from '@/lib/ui';

function RecordSessionPage() {
  const t = useTranslations('clinical');
  const params = useSearchParams();

  return (
    <main className={`${ui.page} max-w-2xl`}>
      <h1 className={ui.h1}>{t('record')}</h1>
      <WithActiveOrganization>
        {(active) =>
          // UX only: the API refuses admin_staff (clinicalSessions.write) and RLS does too.
          active.role === 'admin_staff' ? (
            <Alert tone="info">{t('clinicianOnly')}</Alert>
          ) : (
            <RecordSession
              organizationId={active.organizationId}
              userId={active.userId}
              patientId={params.get('patientId')}
              appointmentId={params.get('appointmentId')}
            />
          )
        }
      </WithActiveOrganization>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <RecordSessionPage />
    </Suspense>
  );
}
