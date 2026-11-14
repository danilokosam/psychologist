'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Calendar } from '@/components/appointments/calendar';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { parseDateParam, toDateInput, type CalendarView } from '@/lib/calendar';
import { ui } from '@/lib/ui';

const VIEWS: CalendarView[] = ['day', 'week', 'month'];

function CalendarPage() {
  const t = useTranslations('appointments');
  const params = useSearchParams();
  const view = VIEWS.find((v) => v === params.get('view')) ?? 'week';
  const anchor = parseDateParam(params.get('date')) ?? new Date();

  return (
    <main className={`${ui.page} max-w-6xl`}>
      <div className="flex items-center justify-between gap-4">
        <h1 className={ui.h1}>{t('title')}</h1>
        <Link href={`/appointments/new?date=${toDateInput(anchor)}`} className={ui.button.primary}>
          + {t('new')}
        </Link>
      </div>
      <div className="space-y-4">
        <WithActiveOrganization>
          {(active) => (
            <Calendar
              key={active.organizationId}
              organizationId={active.organizationId}
              view={view}
              anchor={anchor}
              professionalId={params.get('professional')}
            />
          )}
        </WithActiveOrganization>
      </div>
    </main>
  );
}

// useSearchParams needs a Suspense boundary in the App Router.
export default function AppointmentsPage() {
  return (
    <Suspense>
      <CalendarPage />
    </Suspense>
  );
}
