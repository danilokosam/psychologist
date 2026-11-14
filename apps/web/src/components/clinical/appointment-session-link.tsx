'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { listClinicalSessionsResponseSchema, type Appointment, type MembershipRole } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { ui } from '@/lib/ui';

/**
 * On an appointment: link to its recorded session, or -- for clinicians,
 * once it has started and unless cancelled -- offer to record it.
 */
export function AppointmentSessionLink({
  organizationId,
  appointment,
  role,
}: {
  organizationId: string;
  appointment: Appointment;
  role: MembershipRole;
}) {
  const t = useTranslations('clinical');
  const [sessionId, setSessionId] = useState<string | null | undefined>(undefined);
  // Read once per mount: "has it started?" only decides whether to offer a button.
  const [startedAlready] = useState(() => Date.parse(appointment.startsAt) <= Date.now());

  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>(`/clinical-sessions?appointmentId=${appointment.id}`, { organizationId }).then(
      (raw) => {
        if (!cancelled) setSessionId(listClinicalSessionsResponseSchema.parse(raw).sessions[0]?.id ?? null);
      },
      () => {
        if (!cancelled) setSessionId(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, appointment.id]);

  if (sessionId === undefined) return null;
  if (sessionId) {
    return (
      <Link href={`/clinical-sessions/${sessionId}`} className={ui.button.secondary}>
        {t('viewSession')}
      </Link>
    );
  }
  if (role === 'admin_staff' || appointment.status === 'cancelled' || !startedAlready) return null;
  return (
    <Link href={`/clinical-sessions/new?appointmentId=${appointment.id}`} className={ui.button.primary}>
      {t('recordFromAppointment')}
    </Link>
  );
}
