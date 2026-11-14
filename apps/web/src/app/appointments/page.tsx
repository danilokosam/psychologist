'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Calendar } from '@/components/appointments/calendar';
import { WithActiveOrganization } from '@/components/patients/with-active-organization';
import { parseDateParam, toDateInput, type CalendarView } from '@/lib/calendar';

const VIEWS: CalendarView[] = ['day', 'week', 'month'];

function CalendarPage() {
  const t = useTranslations('appointments');
  const params = useSearchParams();
  const view = VIEWS.find((v) => v === params.get('view')) ?? 'week';
  const anchor = parseDateParam(params.get('date')) ?? new Date();

  return (
    <main className="flex-1 bg-zinc-50 p-6 dark:bg-black">
      <div className="mx-auto max-w-6xl space-y-4">
        <Link href="/dashboard" className="text-sm text-zinc-600 underline dark:text-zinc-400">
          {t('backToDashboard')}
        </Link>
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">{t('title')}</h1>
          <Link
            href={`/appointments/new?date=${toDateInput(anchor)}`}
            className="rounded bg-black px-3 py-1.5 text-sm text-white dark:bg-white dark:text-black"
          >
            {t('new')}
          </Link>
        </div>
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
