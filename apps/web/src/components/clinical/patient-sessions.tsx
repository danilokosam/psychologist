'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { listClinicalSessionsResponseSchema, type ClinicalSession } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { ui } from '@/lib/ui';
import { Spinner } from '../ui/feedback';

/**
 * A patient's session history (metadata only -- every role may see it; note
 * content lives on the session page and only clinicians reach it).
 */
export function PatientSessions({
  organizationId,
  patientId,
  canRecord,
}: {
  organizationId: string;
  patientId: string;
  canRecord: boolean;
}) {
  const t = useTranslations('clinical');
  const format = useFormatter();
  const [sessions, setSessions] = useState<ClinicalSession[] | null>(null);
  const [total, setTotal] = useState(0);

  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>(`/clinical-sessions?patientId=${patientId}&pageSize=10`, { organizationId }).then(
      (raw) => {
        if (cancelled) return;
        const parsed = listClinicalSessionsResponseSchema.parse(raw);
        setSessions(parsed.sessions);
        setTotal(parsed.total);
      },
      () => {
        if (!cancelled) setSessions([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, patientId]);

  return (
    <div className={`${ui.card} space-y-3 text-sm`}>
      <div className="flex items-center justify-between">
        <h2 className={ui.h2}>{t('sessions')}</h2>
        {canRecord ? (
          <Link href={`/clinical-sessions/new?patientId=${patientId}`} className={ui.button.secondary}>
            + {t('record')}
          </Link>
        ) : null}
      </div>
      {sessions === null ? <Spinner label={t('loading')} /> : null}
      {sessions?.length === 0 ? <p className="text-muted">{t('noSessions')}</p> : null}
      <ul className="divide-y divide-border">
        {sessions?.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
            <Link href={`/clinical-sessions/${s.id}`} className={ui.link}>
              {format.dateTime(new Date(s.startedAt), { dateStyle: 'medium', timeStyle: 'short' })}
            </Link>
            <span className="text-muted">
              {t('minutes', { count: s.durationMinutes })} · {s.professional.fullName ?? t('formerMember')}
            </span>
          </li>
        ))}
      </ul>
      {total > (sessions?.length ?? 0) ? <p className="text-xs text-muted">{t('olderSessions', { count: total - (sessions?.length ?? 0) })}</p> : null}
    </div>
  );
}
