'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { appointmentResponseSchema, type Appointment } from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { toDateInput } from '@/lib/calendar';
import { AppointmentForm, appointmentErrorKey, type AppointmentFormValues } from './appointment-form';

type State = { kind: 'loading' } | { kind: 'ready'; appointment: Appointment } | { kind: 'not_found' } | { kind: 'error' };

/** View, reschedule/edit and cancel one appointment (any role, per the matrix). */
export function AppointmentDetail({ organizationId, appointmentId }: { organizationId: string; appointmentId: string }) {
  const t = useTranslations('appointments');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; key: string } | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>(`/appointments/${appointmentId}`, { organizationId }).then(
      (raw) => {
        if (!cancelled) setState({ kind: 'ready', appointment: appointmentResponseSchema.parse(raw).appointment });
      },
      (error: unknown) => {
        if (!cancelled) setState({ kind: error instanceof ApiError && error.status === 404 ? 'not_found' : 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, appointmentId]);

  function show(appointment: Appointment, key: string) {
    setState({ kind: 'ready', appointment });
    setFormKey((k) => k + 1);
    setMessage({ tone: 'ok', key });
  }

  async function save(values: AppointmentFormValues) {
    setMessage(null);
    // Never the patient: an appointment does not change patient (the API
    // would refuse the key anyway).
    const raw = await apiFetch<unknown>(`/appointments/${appointmentId}`, {
      method: 'PATCH',
      organizationId,
      body: {
        professionalId: values.professionalId,
        startsAt: values.startsAt,
        endsAt: values.endsAt,
        modality: values.modality,
        status: values.status,
      },
    });
    show(appointmentResponseSchema.parse(raw).appointment, 'saved');
  }

  async function cancelAppointment() {
    setConfirmingCancel(false);
    setMessage(null);
    try {
      const raw = await apiFetch<unknown>(`/appointments/${appointmentId}/cancel`, { method: 'POST', organizationId });
      show(appointmentResponseSchema.parse(raw).appointment, 'cancelledDone');
    } catch (error) {
      setMessage({ tone: 'error', key: appointmentErrorKey(error) });
    }
  }

  if (state.kind === 'loading') return <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('loading')}</p>;
  if (state.kind === 'not_found') return <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('notFound')}</p>;
  if (state.kind === 'error') {
    return (
      <p role="alert" className="text-sm text-red-600 dark:text-red-400">
        {t('loadFailed')}
      </p>
    );
  }

  const { appointment } = state;
  const start = new Date(appointment.startsAt);
  const cancelled = appointment.status === 'cancelled';

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
          <Link href={`/patients/${appointment.patient.id}`} className="underline">
            {appointment.patient.fullName}
          </Link>
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {format.dateTimeRange(start, new Date(appointment.endsAt), { dateStyle: 'full', timeStyle: 'short' })}
        </p>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {appointment.professional.fullName ?? t('unknownProfessional')} · {t(`modality.${appointment.modality}`)} ·{' '}
          {t(`status.${appointment.status}`)}
        </p>
        <Link href={`/appointments?view=day&date=${toDateInput(start)}`} className="text-sm underline">
          {t('showInCalendar')}
        </Link>
      </div>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${message.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}
        >
          {t(message.key)}
        </p>
      ) : null}

      {cancelled ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('cancelledFinal')}</p>
      ) : (
        <>
          <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
            <AppointmentForm
              key={formKey}
              organizationId={organizationId}
              appointment={appointment}
              submitLabel={t('save')}
              onSubmit={save}
            />
          </div>
          <div className="space-y-2 rounded border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
            {confirmingCancel ? (
              <span className="space-x-3">
                <span>{t('cancelConfirm')}</span>
                <button type="button" onClick={() => void cancelAppointment()} className="font-medium text-red-700 underline dark:text-red-400">
                  {t('cancelYes')}
                </button>
                <button type="button" onClick={() => setConfirmingCancel(false)} className="underline">
                  {t('keep')}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmingCancel(true)} className="text-red-700 underline dark:text-red-400">
                {t('cancelAppointment')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
