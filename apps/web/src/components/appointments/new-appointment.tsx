'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { appointmentResponseSchema, patientResponseSchema } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { AppointmentForm, type AppointmentFormValues } from './appointment-form';
import { ui } from '@/lib/ui';
import { Spinner } from '../ui/feedback';

export function NewAppointment({
  organizationId,
  initialDate,
  patientId,
}: {
  organizationId: string;
  initialDate: Date | null;
  patientId: string | null;
}) {
  const t = useTranslations('appointments');
  const router = useRouter();
  // Pre-selected patient (from the patient page). Loaded before the form
  // renders, so the form starts with it rather than flipping afterwards.
  const [patient, setPatient] = useState<{ id: string; fullName: string } | null | undefined>(
    patientId ? undefined : null,
  );

  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    apiFetch<unknown>(`/patients/${patientId}`, { organizationId }).then(
      (raw) => {
        const p = patientResponseSchema.parse(raw).patient;
        if (!cancelled) setPatient(p.status === 'archived' ? null : { id: p.id, fullName: p.fullName });
      },
      () => {
        if (!cancelled) setPatient(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, patientId]);

  async function create(values: AppointmentFormValues) {
    const raw = await apiFetch<unknown>('/appointments', { method: 'POST', organizationId, body: values });
    router.push(`/appointments/${appointmentResponseSchema.parse(raw).appointment.id}`);
  }

  if (patient === undefined) return <Spinner label={t('loading')} />;

  return (
    <div className={ui.card}>
      <AppointmentForm
        organizationId={organizationId}
        initialDate={initialDate ?? undefined}
        initialPatient={patient}
        submitLabel={t('book')}
        onSubmit={create}
      />
    </div>
  );
}
