'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { NewAppointment } from '@/components/appointments/new-appointment';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { parseDateParam } from '@/lib/calendar';
import { ui } from '@/lib/ui';

function NewAppointmentPage() {
  const t = useTranslations('appointments');
  const params = useSearchParams();

  return (
    <main className={`${ui.page} max-w-2xl`}>
      <div className="space-y-4">
        <Link href="/appointments" className="text-sm font-medium text-muted transition-colors duration-150 hover:text-foreground">
          {t('backToCalendar')}
        </Link>
        <h1 className={ui.h1}>{t('new')}</h1>
        <WithActiveOrganization>
          {(active) => (
            <NewAppointment
              organizationId={active.organizationId}
              initialDate={parseDateParam(params.get('date'))}
              patientId={params.get('patientId')}
            />
          )}
        </WithActiveOrganization>
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewAppointmentPage />
    </Suspense>
  );
}
