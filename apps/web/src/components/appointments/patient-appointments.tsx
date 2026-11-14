'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { APPOINTMENTS_MAX_WINDOW_DAYS, listAppointmentsResponseSchema, type Appointment } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { ui } from '@/lib/ui';
import { APPOINTMENT_STATUS_TONE, Badge, Spinner } from '../ui/feedback';

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
    <div className={`${ui.card} space-y-3 text-sm`}>
      <div className="flex items-center justify-between">
        <h2 className={ui.h2}>{t('upcoming')}</h2>
        {canBook ? (
          <Link href={`/appointments/new?patientId=${patientId}`} className={ui.button.secondary}>
            + {t('new')}
          </Link>
        ) : null}
      </div>
      {appointments === null ? <Spinner label={t('loading')} /> : null}
      {appointments?.length === 0 ? <p className="text-muted">{t('noUpcoming')}</p> : null}
      <ul className="divide-y divide-border">
        {appointments?.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-2 py-2">
            <Link href={`/appointments/${a.id}`} className={ui.link}>
              {format.dateTime(new Date(a.startsAt), { dateStyle: 'medium', timeStyle: 'short' })}
            </Link>
            <span className="text-muted">{a.professional.fullName ?? t('unknownProfessional')}</span>
            <Badge tone={APPOINTMENT_STATUS_TONE[a.status]}>{t(`status.${a.status}`)}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
