'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { appointmentResponseSchema, type Appointment } from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { toDateInput } from '@/lib/calendar';
import { AppointmentForm, appointmentErrorKey, type AppointmentFormValues } from './appointment-form';
import { ui } from '@/lib/ui';
import { Alert, APPOINTMENT_STATUS_TONE, Badge, Spinner } from '../ui/feedback';

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

  if (state.kind === 'loading') return <Spinner label={t('loading')} />;
  if (state.kind === 'not_found') return <p className={ui.muted}>{t('notFound')}</p>;
  if (state.kind === 'error') return <Alert tone="danger">{t('loadFailed')}</Alert>;

  const { appointment } = state;
  const start = new Date(appointment.startsAt);
  const cancelled = appointment.status === 'cancelled';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className={ui.h1}>
          <Link href={`/patients/${appointment.patient.id}`} className="underline-offset-4 hover:underline">
            {appointment.patient.fullName}
          </Link>
        </h1>
        <p className="text-sm text-muted">
          {format.dateTimeRange(start, new Date(appointment.endsAt), { dateStyle: 'full', timeStyle: 'short' })}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone={APPOINTMENT_STATUS_TONE[appointment.status]}>{t(`status.${appointment.status}`)}</Badge>
          {appointment.professional.fullName ?? t('unknownProfessional')} · {t(`modality.${appointment.modality}`)}
        </p>
        <Link href={`/appointments?view=day&date=${toDateInput(start)}`} className={`${ui.link} text-sm`}>
          {t('showInCalendar')}
        </Link>
      </div>

      {message ? <Alert tone={message.tone === 'error' ? 'danger' : 'success'}>{t(message.key)}</Alert> : null}

      {cancelled ? (
        <Alert tone="info">{t('cancelledFinal')}</Alert>
      ) : (
        <>
          <div className={ui.card}>
            <AppointmentForm
              key={formKey}
              organizationId={organizationId}
              appointment={appointment}
              submitLabel={t('save')}
              onSubmit={save}
            />
          </div>
          <div className={ui.card}>
            {confirmingCancel ? (
              <span className="flex flex-wrap items-center gap-3 text-sm">
                <span className="font-medium">{t('cancelConfirm')}</span>
                <button type="button" onClick={() => void cancelAppointment()} className={ui.button.danger}>
                  {t('cancelYes')}
                </button>
                <button type="button" onClick={() => setConfirmingCancel(false)} className={ui.button.ghost}>
                  {t('keep')}
                </button>
              </span>
            ) : (
              <button type="button" onClick={() => setConfirmingCancel(true)} className={ui.button.danger}>
                {t('cancelAppointment')}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
