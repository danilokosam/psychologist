'use client';

import { use } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AppointmentDetail } from '@/components/appointments/appointment-detail';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';

export default function AppointmentPage({ params }: PageProps<'/appointments/[appointmentId]'>) {
  const t = useTranslations('appointments');
  const { appointmentId } = use(params);

  return (
    <main className="flex-1 bg-zinc-50 p-6 dark:bg-black">
      <div className="mx-auto max-w-xl space-y-4">
        <Link href="/appointments" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          {t('backToCalendar')}
        </Link>
        <WithActiveOrganization>
          {(active) => (
            <AppointmentDetail
              key={`${active.organizationId}:${appointmentId}`}
              organizationId={active.organizationId}
              appointmentId={appointmentId}
            />
          )}
        </WithActiveOrganization>
      </div>
    </main>
  );
}
