'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  listMembersResponseSchema,
  listPatientsResponseSchema,
  type Appointment,
  type AppointmentModality,
  type EditableAppointmentStatus,
  type OrganizationMember,
  type Patient,
} from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { fromInputs, toDateInput, toTimeInput } from '@/lib/calendar';

export type AppointmentFormValues = {
  patientId: string;
  professionalId: string;
  startsAt: string;
  endsAt: string;
  modality: AppointmentModality;
  status: EditableAppointmentStatus;
};

const DURATIONS = [30, 45, 50, 60, 90, 120];

/** Maps an API refusal to the message the user should see. */
export function appointmentErrorKey(error: unknown): string {
  if (!(error instanceof ApiError)) return 'errors.generic';
  switch (error.code) {
    case 'PROFESSIONAL_CONFLICT':
    case 'PATIENT_CONFLICT':
    case 'INVALID_TIME_RANGE':
    case 'INVALID_PROFESSIONAL':
    case 'INVALID_PATIENT':
    case 'PATIENT_ARCHIVED':
    case 'NOT_YET_HAPPENED':
    case 'APPOINTMENT_CANCELLED':
      return `errors.${error.code}`;
    default:
      return 'errors.generic';
  }
}

/**
 * Book or edit an appointment. The patient is chosen by search on create and
 * fixed on edit (an appointment never changes patient). Times are entered in
 * the browser's local zone and sent as absolute instants.
 */
export function AppointmentForm({
  organizationId,
  appointment,
  initialDate,
  initialPatient,
  submitLabel,
  onSubmit,
}: {
  organizationId: string;
  appointment?: Appointment;
  initialDate?: Date | undefined;
  initialPatient?: { id: string; fullName: string } | null;
  submitLabel: string;
  onSubmit: (values: AppointmentFormValues) => Promise<void>;
}) {
  const t = useTranslations('appointments');
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [patient, setPatient] = useState<{ id: string; fullName: string } | null>(
    appointment ? appointment.patient : (initialPatient ?? null),
  );
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Patient[]>([]);
  const start = appointment ? new Date(appointment.startsAt) : null;
  const [date, setDate] = useState(toDateInput(start ?? initialDate ?? new Date()));
  const [time, setTime] = useState(start ? toTimeInput(start) : '09:00');
  const [duration, setDuration] = useState(
    appointment ? Math.round((Date.parse(appointment.endsAt) - Date.parse(appointment.startsAt)) / 60_000) : 50,
  );
  const [professionalId, setProfessionalId] = useState(appointment?.professional.userId ?? '');
  const [modality, setModality] = useState<AppointmentModality>(appointment?.modality ?? 'in_person');
  const [status, setStatus] = useState<EditableAppointmentStatus>(
    appointment && appointment.status !== 'cancelled' ? appointment.status : 'scheduled',
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>('/organizations/current/members', { organizationId }).then(
      (raw) => {
        if (cancelled) return;
        const clinicians = listMembersResponseSchema.parse(raw).members.filter((m) => m.role !== 'admin_staff');
        setMembers(clinicians);
        // Default to the only clinician (the solo-practice case).
        if (clinicians.length === 1) setProfessionalId((current) => current || clinicians[0]!.userId);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    if (appointment || query.trim().length < 2) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query.trim(), pageSize: '10', status: 'active' });
      apiFetch<unknown>(`/patients?${params.toString()}`, { organizationId }).then(
        (raw) => {
          if (!cancelled) setMatches(listPatientsResponseSchema.parse(raw).patients);
        },
        () => undefined,
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [appointment, query, organizationId]);

  // An appointment that has been cancelled cannot be edited; the page shows
  // that instead of the form. Outcomes only for edits (a new booking is
  // scheduled or confirmed).
  const statuses: EditableAppointmentStatus[] = appointment
    ? ['scheduled', 'confirmed', 'completed', 'no_show']
    : ['scheduled', 'confirmed'];
  const durations = DURATIONS.includes(duration) ? DURATIONS : [...DURATIONS, duration].sort((a, b) => a - b);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const startsAt = fromInputs(date, time);
    if (!patient || !professionalId || !startsAt) {
      setError('errors.incomplete');
      return;
    }
    setError(null);
    setPending(true);
    try {
      await onSubmit({
        patientId: patient.id,
        professionalId,
        startsAt: startsAt.toISOString(),
        endsAt: new Date(startsAt.getTime() + duration * 60_000).toISOString(),
        modality,
        status,
      });
    } catch (caught) {
      setError(appointmentErrorKey(caught));
    } finally {
      setPending(false);
    }
  }

  const field = 'w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900';
  const label = 'block text-sm text-zinc-700 dark:text-zinc-300';

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset disabled={pending} className="space-y-3">
        <div className="space-y-1">
          <span className={label}>{t('patient')}</span>
          {patient ? (
            <p className="flex items-center justify-between text-sm font-medium">
              {patient.fullName}
              {appointment ? null : (
                <button type="button" onClick={() => setPatient(null)} className="text-xs font-normal underline">
                  {t('changePatient')}
                </button>
              )}
            </p>
          ) : (
            <>
              <label htmlFor="appointment-patient-search" className="sr-only">
                {t('searchPatient')}
              </label>
              <input
                id="appointment-patient-search"
                type="search"
                autoComplete="off"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchPatient')}
                className={field}
              />
              {query.trim().length >= 2 ? (
                <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 text-sm dark:divide-zinc-800 dark:border-zinc-800">
                  {matches.length === 0 ? <li className="px-2 py-1 text-zinc-500">{t('noPatientMatches')}</li> : null}
                  {matches.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setPatient({ id: p.id, fullName: p.fullName })}
                        className="w-full px-2 py-1 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        {p.fullName}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <label htmlFor="appointment-date" className={label}>
              {t('date')}
            </label>
            <input id="appointment-date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </div>
          <div className="space-y-1">
            <label htmlFor="appointment-time" className={label}>
              {t('time')}
            </label>
            <input id="appointment-time" type="time" required step={300} value={time} onChange={(e) => setTime(e.target.value)} className={field} />
          </div>
          <div className="space-y-1">
            <label htmlFor="appointment-duration" className={label}>
              {t('duration')}
            </label>
            <select id="appointment-duration" value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={field}>
              {durations.map((d) => (
                <option key={d} value={d}>
                  {t('minutes', { count: d })}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1">
          <label htmlFor="appointment-professional" className={label}>
            {t('professional')}
          </label>
          <select
            id="appointment-professional"
            required
            value={professionalId}
            onChange={(e) => setProfessionalId(e.target.value)}
            className={field}
          >
            <option value="" disabled>
              {t('chooseProfessional')}
            </option>
            {/* A professional no longer active still shows on an existing appointment. */}
            {appointment && !members.some((m) => m.userId === appointment.professional.userId) ? (
              <option value={appointment.professional.userId}>
                {appointment.professional.fullName ?? t('unknownProfessional')}
              </option>
            ) : null}
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.fullName ?? t('unknownProfessional')}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor="appointment-modality" className={label}>
              {t('modalityLabel')}
            </label>
            <select id="appointment-modality" value={modality} onChange={(e) => setModality(e.target.value as AppointmentModality)} className={field}>
              <option value="in_person">{t('modality.in_person')}</option>
              <option value="online">{t('modality.online')}</option>
            </select>
          </div>
          <div className="space-y-1">
            <label htmlFor="appointment-status" className={label}>
              {t('statusLabel')}
            </label>
            <select id="appointment-status" value={status} onChange={(e) => setStatus(e.target.value as EditableAppointmentStatus)} className={field}>
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {t(`status.${s}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {t(error)}
          </p>
        ) : null}

        <button type="submit" className="rounded bg-black px-3 py-1.5 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-black">
          {pending ? t('saving') : submitLabel}
        </button>
      </fieldset>
    </form>
  );
}
