'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { clinicalSessionResponseSchema, patientResponseSchema, type ClinicalSession, type MembershipRole } from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { ui } from '@/lib/ui';
import { Alert, Spinner } from '../ui/feedback';
import { SessionNotes } from './session-notes';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; session: ClinicalSession; patientArchived: boolean }
  | { kind: 'not_found' }
  | { kind: 'error' };

/**
 * One clinical session: metadata for everyone, notes for clinicians only.
 * admin_staff never mounts SessionNotes, so not even a refused request is
 * made on their behalf.
 */
export function SessionDetail({
  organizationId,
  sessionId,
  role,
  userId,
}: {
  organizationId: string;
  sessionId: string;
  role: MembershipRole;
  userId: string;
}) {
  const t = useTranslations('clinical');
  const format = useFormatter();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const clinician = role !== 'admin_staff';

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<State> {
      const { session } = clinicalSessionResponseSchema.parse(await apiFetch<unknown>(`/clinical-sessions/${sessionId}`, { organizationId }));
      const { patient } = patientResponseSchema.parse(await apiFetch<unknown>(`/patients/${session.patient.id}`, { organizationId }));
      return { kind: 'ready', session, patientArchived: patient.status === 'archived' };
    }
    load().then(
      (next) => {
        if (!cancelled) setState(next);
      },
      (error: unknown) => {
        if (!cancelled) setState({ kind: error instanceof ApiError && error.status === 404 ? 'not_found' : 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, sessionId]);

  if (state.kind === 'loading') return <Spinner label={t('loading')} />;
  if (state.kind === 'not_found') return <p className={ui.muted}>{t('notFound')}</p>;
  if (state.kind === 'error') return <Alert tone="danger">{t('errors.generic')}</Alert>;

  const { session } = state;
  const start = new Date(session.startedAt);
  const end = new Date(start.getTime() + session.durationMinutes * 60_000);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm font-medium text-primary-soft-foreground">{t('session')}</p>
        <h1 className={ui.h1}>
          <Link href={`/patients/${session.patient.id}`} className="underline-offset-4 hover:underline">
            {session.patient.fullName}
          </Link>
        </h1>
        <p className={ui.muted}>
          {format.dateTimeRange(start, end, { dateStyle: 'full', timeStyle: 'short' })} · {t('minutes', { count: session.durationMinutes })}
        </p>
        <p className={ui.muted}>
          {session.professional.fullName ?? t('formerMember')}
          {session.appointmentId ? (
            <>
              {' · '}
              <Link href={`/appointments/${session.appointmentId}`} className={ui.link}>{t('viewAppointment')}</Link>
            </>
          ) : null}
        </p>
      </div>
      {clinician ? (
        <SessionNotes organizationId={organizationId} sessionId={session.id} userId={userId} frozen={state.patientArchived} />
      ) : (
        <Alert tone="info">{t('notesClinicianOnly')}</Alert>
      )}
    </div>
  );
}
