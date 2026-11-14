'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { patientResponseSchema, type MembershipRole, type Patient } from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { PatientForm, type PatientFormValues } from './patient-form';
import { PatientAppointments } from '../appointments/patient-appointments';
import { ui } from '@/lib/ui';
import { Alert, Badge, PATIENT_STATUS_TONE, Spinner } from '../ui/feedback';
import { PatientSessions } from '../clinical/patient-sessions';

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

  if (state.kind === 'loading') return <Spinner label={t('loading')} />;
  if (state.kind === 'not_found') return <p className={ui.muted}>{t('notFound')}</p>;
  if (state.kind === 'error') return <Alert tone="danger">{t('loadFailed')}</Alert>;

  const { patient } = state;
  const archived = patient.status === 'archived';

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className={ui.h1}>{patient.fullName}</h1>
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone={PATIENT_STATUS_TONE[patient.status]}>{t(`status.${patient.status}`)}</Badge>
          {patient.archivedAt
            ? ` · ${t('archivedOn', { date: format.dateTime(new Date(patient.archivedAt), { dateStyle: 'medium' }) })}`
            : null}
        </p>
      </div>

      {message ? <Alert tone={message.tone === 'error' ? 'danger' : 'success'}>{message.text}</Alert> : null}

      {archived ? <Alert tone="info">{t('archivedReadOnly')}</Alert> : null}

      <div className={ui.card}>
        <PatientForm key={formKey} patient={patient} submitLabel={t('save')} onSubmit={save} disabled={archived} />
      </div>

      <PatientAppointments organizationId={organizationId} patientId={patient.id} canBook={!archived} />
      <PatientSessions organizationId={organizationId} patientId={patient.id} canRecord={!archived && role !== 'admin_staff'} />

      {role === 'owner' ? (
        <div className={`${ui.card} space-y-3`}>
          <h2 className={ui.h2}>{t('archiveTitle')}</h2>
          <p className={ui.muted}>{t('archiveExplanation')}</p>
          {archived ? (
            <button type="button" onClick={() => void transition('restore')} className={ui.button.secondary}>
              {t('restore')}
            </button>
          ) : confirmingArchive ? (
            // An inline second step rather than window.confirm(), which
            // blocks the page and can't be translated or styled.
            <span className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-medium">{t('archiveConfirm')}</span>
              <button
                type="button"
                onClick={() => void transition('archive')}
                className={ui.button.danger}
              >
                {t('archiveYes')}
              </button>
              <button type="button" onClick={() => setConfirmingArchive(false)} className={ui.button.ghost}>
                {t('cancel')}
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmingArchive(true)} className={ui.button.danger}>
              {t('archive')}
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
