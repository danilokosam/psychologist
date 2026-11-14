'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { APPOINTMENTS_MAX_WINDOW_DAYS, listAppointmentsResponseSchema, type Appointment } from '@psych/types';
import { apiFetch } from '@/lib/api-client';

/** A patient's upcoming appointments (the next ~2 months), on the patient page. */
export function PatientAppointments({
  organizationId,
  patientId,
  canBook,
}: {
  organizationId: string;
  patientId: string;
  canBook: boolean;
}) {
  const t = useTranslations('appointments');
  const format = useFormatter();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const from = new Date();
    const to = new Date(from.getTime() + APPOINTMENTS_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), patientId });
    apiFetch<unknown>(`/appointments?${params.toString()}`, { organizationId }).then(
      (raw) => {
        if (!cancelled) setAppointments(listAppointmentsResponseSchema.parse(raw).appointments);
      },
      () => {
        if (!cancelled) setAppointments([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, patientId]);

  return (
    <div className="space-y-2 rounded border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{t('upcoming')}</h2>
        {canBook ? (
          <Link href={`/appointments/new?patientId=${patientId}`} className="underline">
            {t('new')}
          </Link>
        ) : null}
      </div>
      {appointments === null ? <p className="text-zinc-600 dark:text-zinc-400">{t('loading')}</p> : null}
      {appointments?.length === 0 ? <p className="text-zinc-600 dark:text-zinc-400">{t('noUpcoming')}</p> : null}
      <ul className="space-y-1">
        {appointments?.map((a) => (
          <li key={a.id}>
            <Link href={`/appointments/${a.id}`} className="underline">
              {format.dateTime(new Date(a.startsAt), { dateStyle: 'medium', timeStyle: 'short' })}
            </Link>{' '}
            · {a.professional.fullName ?? t('unknownProfessional')} · {t(`status.${a.status}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}
