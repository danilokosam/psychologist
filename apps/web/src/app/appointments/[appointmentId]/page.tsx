'use client';

import { use } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { AppointmentDetail } from '@/components/appointments/appointment-detail';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { ui } from '@/lib/ui';

export default function AppointmentPage({ params }: PageProps<'/appointments/[appointmentId]'>) {
  const t = useTranslations('appointments');
  const { appointmentId } = use(params);

  return (
    <main className={`${ui.page} max-w-2xl`}>
      <div className="space-y-4">
        <Link href="/appointments" className="text-sm font-medium text-muted transition-colors duration-150 hover:text-foreground">
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
