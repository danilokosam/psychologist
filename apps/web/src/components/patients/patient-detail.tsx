'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { patientResponseSchema, type MembershipRole, type Patient } from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { PatientForm, type PatientFormValues } from './patient-form';
import { PatientAppointments } from '../appointments/patient-appointments';

type State = { kind: 'loading' } | { kind: 'ready'; patient: Patient } | { kind: 'not_found' } | { kind: 'error' };

/**
 * View and edit one patient; owners also archive/restore (ADR-0014).
 *
 * Showing the archive button only to owners is a UX nicety, not the control:
 * requireRole(PERMISSIONS['patients.archive']) and the patients_update RLS
 * policy both refuse everyone else.
 */
export function PatientDetail({
  organizationId,
  role,
  patientId,
}: {
  organizationId: string;
  role: MembershipRole;
  patientId: string;
}) {
  const t = useTranslations('patients');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  // Remounts the form with fresh values after a save or a state change.
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>(`/patients/${patientId}`, { organizationId }).then(
      (raw) => {
        if (!cancelled) setState({ kind: 'ready', patient: patientResponseSchema.parse(raw).patient });
      },
      (error: unknown) => {
        if (cancelled) return;
        // Unknown, malformed and other-organization ids all look the same.
        setState({ kind: error instanceof ApiError && error.status === 404 ? 'not_found' : 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, patientId]);

  function show(patient: Patient, text: string) {
    setState({ kind: 'ready', patient });
    setFormKey((key) => key + 1);
    setMessage({ tone: 'ok', text });
  }

  async function save(values: PatientFormValues) {
    setMessage(null);
    try {
      const raw = await apiFetch<unknown>(`/patients/${patientId}`, {
        method: 'PATCH',
        organizationId,
        body: values,
      });
      show(patientResponseSchema.parse(raw).patient, t('saved'));
    } catch (error) {
      const archived = error instanceof ApiError && error.status === 409;
      setMessage({ tone: 'error', text: archived ? t('archivedReadOnly') : t('saveFailed') });
    }
  }

  async function transition(action: 'archive' | 'restore') {
    setMessage(null);
    setConfirmingArchive(false);
    try {
      const raw = await apiFetch<unknown>(`/patients/${patientId}/${action}`, { method: 'POST', organizationId });
      show(patientResponseSchema.parse(raw).patient, action === 'archive' ? t('archivedDone') : t('restoredDone'));
    } catch {
      setMessage({ tone: 'error', text: t('actionFailed') });
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

  const { patient } = state;
  const archived = patient.status === 'archived';

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">{patient.fullName}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {t(`status.${patient.status}`)}
          {patient.archivedAt
            ? ` · ${t('archivedOn', { date: format.dateTime(new Date(patient.archivedAt), { dateStyle: 'medium' }) })}`
            : null}
        </p>
      </div>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm ${message.tone === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}
        >
          {message.text}
        </p>
      ) : null}

      {archived ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('archivedReadOnly')}</p> : null}

      <div className="rounded border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
        <PatientForm key={formKey} patient={patient} submitLabel={t('save')} onSubmit={save} disabled={archived} />
      </div>

      <PatientAppointments organizationId={organizationId} patientId={patient.id} canBook={!archived} />

      {role === 'owner' ? (
        <div className="space-y-2 rounded border border-zinc-200 bg-white p-4 text-sm dark:border-zinc-800 dark:bg-zinc-900">
          <h2 className="font-medium">{t('archiveTitle')}</h2>
          <p className="text-zinc-600 dark:text-zinc-400">{t('archiveExplanation')}</p>
          {archived ? (
            <button type="button" onClick={() => void transition('restore')} className="underline">
              {t('restore')}
            </button>
          ) : confirmingArchive ? (
            // An inline second step rather than window.confirm(), which
            // blocks the page and can't be translated or styled.
            <span className="space-x-3">
              <span>{t('archiveConfirm')}</span>
              <button
                type="button"
                onClick={() => void transition('archive')}
                className="font-medium text-red-700 underline dark:text-red-400"
              >
                {t('archiveYes')}
              </button>
              <button type="button" onClick={() => setConfirmingArchive(false)} className="underline">
                {t('cancel')}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingArchive(true)} className="text-red-700 underline dark:text-red-400">
              {t('archive')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
