'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  SESSION_MAX_MINUTES,
  appointmentResponseSchema,
  clinicalSessionResponseSchema,
  listMembersResponseSchema,
  patientResponseSchema,
  type OrganizationMember,
} from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { fromInputs, toDateInput, toTimeInput } from '@/lib/calendar';
import { ui } from '@/lib/ui';
import { Alert, Spinner } from '../ui/feedback';

type Prefill = {
  patient: { id: string; fullName: string };
  professionalId: string;
  startedAt: Date;
  durationMinutes: number;
  appointmentId: string | null;
};

const ERROR_KEYS = new Set([
  'INVALID_PATIENT',
  'PATIENT_ARCHIVED',
  'INVALID_PROFESSIONAL',
  'NOT_YET_HAPPENED',
  'INVALID_APPOINTMENT',
  'APPOINTMENT_CANCELLED',
  'SESSION_ALREADY_RECORDED',
]);

/**
 * Records that a session took place (F-008). Started from a patient page, or
 * from an appointment -- then everything is prefilled from it and saving
 * also marks the appointment completed (server side).
 */
export function RecordSession({
  organizationId,
  userId,
  patientId,
  appointmentId,
}: {
  organizationId: string;
  userId: string;
  patientId: string | null;
  appointmentId: string | null;
}) {
  const t = useTranslations('clinical');
  const router = useRouter();
  const [prefill, setPrefill] = useState<Prefill | null | 'missing'>(null);
  const [clinicians, setClinicians] = useState<OrganizationMember[]>([]);
  const [values, setValues] = useState({ date: '', time: '', duration: 50, professionalId: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<Prefill | 'missing'> {
      const members = listMembersResponseSchema.parse(await apiFetch<unknown>('/organizations/current/members', { organizationId }));
      if (!cancelled) setClinicians(members.members.filter((m) => m.role !== 'admin_staff'));
      if (appointmentId) {
        const { appointment } = appointmentResponseSchema.parse(await apiFetch<unknown>(`/appointments/${appointmentId}`, { organizationId }));
        return {
          patient: appointment.patient,
          professionalId: appointment.professional.userId,
          startedAt: new Date(appointment.startsAt),
          durationMinutes: Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000),
          appointmentId,
        };
      }
      if (!patientId) return 'missing';
      const { patient } = patientResponseSchema.parse(await apiFetch<unknown>(`/patients/${patientId}`, { organizationId }));
      return { patient: { id: patient.id, fullName: patient.fullName }, professionalId: userId, startedAt: new Date(), durationMinutes: 50, appointmentId: null };
    }
    load().then(
      (p) => {
        if (cancelled) return;
        setPrefill(p);
        if (p !== 'missing') {
          setValues({ date: toDateInput(p.startedAt), time: toTimeInput(p.startedAt), duration: p.durationMinutes, professionalId: p.professionalId });
        }
      },
      () => {
        if (!cancelled) setPrefill('missing');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, userId, patientId, appointmentId]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!prefill || prefill === 'missing') return;
    const startedAt = fromInputs(values.date, values.time);
    if (!startedAt) return;
    setError(null);
    setPending(true);
    try {
      const raw = await apiFetch<unknown>('/clinical-sessions', {
        method: 'POST',
        organizationId,
        body: {
          patientId: prefill.patient.id,
          professionalId: values.professionalId,
          startedAt: startedAt.toISOString(),
          durationMinutes: values.duration,
          ...(prefill.appointmentId ? { appointmentId: prefill.appointmentId } : {}),
        },
      });
      router.push(`/clinical-sessions/${clinicalSessionResponseSchema.parse(raw).session.id}`);
    } catch (caught) {
      setError(caught instanceof ApiError && ERROR_KEYS.has(caught.code) ? `errors.${caught.code}` : 'errors.generic');
      setPending(false);
    }
  }

  if (prefill === null) return <Spinner label={t('loading')} />;
  if (prefill === 'missing') return <Alert tone="danger">{t('errors.generic')}</Alert>;

  return (
    <form onSubmit={submit} className={`${ui.card} space-y-4`}>
      <fieldset disabled={pending} className="space-y-4">
        <div className="space-y-1.5">
          <span className={ui.label}>{t('patient')}</span>
          <p className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-sm font-medium">{prefill.patient.fullName}</p>
          {prefill.appointmentId ? <p className="text-xs text-muted">{t('fromAppointment')}</p> : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="session-date" className={ui.label}>{t('date')}</label>
            <input id="session-date" type="date" required value={values.date} max={toDateInput(new Date())} onChange={(e) => setValues({ ...values, date: e.target.value })} className={ui.input} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="session-time" className={ui.label}>{t('time')}</label>
            <input id="session-time" type="time" required step={300} value={values.time} onChange={(e) => setValues({ ...values, time: e.target.value })} className={ui.input} />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="session-duration" className={ui.label}>{t('duration')}</label>
            <input id="session-duration" type="number" required min={1} max={SESSION_MAX_MINUTES} value={values.duration} onChange={(e) => setValues({ ...values, duration: Number(e.target.value) })} className={ui.input} />
          </div>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="session-professional" className={ui.label}>{t('professional')}</label>
          <select id="session-professional" required value={values.professionalId} onChange={(e) => setValues({ ...values, professionalId: e.target.value })} className={ui.input}>
            {clinicians.map((m) => (
              <option key={m.userId} value={m.userId}>{m.fullName ?? t('formerMember')}</option>
            ))}
          </select>
        </div>
        {error ? <Alert tone="danger">{t(error)}</Alert> : null}
        <button type="submit" className={ui.button.primary}>{pending ? t('saving') : t('record')}</button>
      </fieldset>
    </form>
  );
}
