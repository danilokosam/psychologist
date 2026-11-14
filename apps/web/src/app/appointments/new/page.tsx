'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { NewAppointment } from '@/components/appointments/new-appointment';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { parseDateParam } from '@/lib/calendar';

function NewAppointmentPage() {
  const t = useTranslations('appointments');
  const params = useSearchParams();

  return (
    <main className="flex-1 bg-zinc-50 p-6 dark:bg-black">
      <div className="mx-auto max-w-xl space-y-4">
        <Link href="/appointments" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          {t('backToCalendar')}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">{t('new')}</h1>
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
