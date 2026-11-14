'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { listPatientsResponseSchema, type ListPatientsResponse, type PatientStatus } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { formatCalendarDate } from '@/lib/calendar-date';
import { ui } from '@/lib/ui';
import { Alert, Badge, PATIENT_STATUS_TONE, Spinner } from '../ui/feedback';

const PAGE_SIZE = 20;
type StatusFilter = 'working' | PatientStatus;

/**
 * The organization's patients: search, status filter and pagination, all
 * done by the API (page/pageSize, docs/API.md) -- the browser never holds
 * more than one page of personal data.
 */
export function PatientsList({ organizationId }: { organizationId: string }) {
  const t = useTranslations('patients');
  const format = useFormatter();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('working');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ListPatientsResponse | null>(null);
  const [failed, setFailed] = useState(false);

  // Debounce typing so every keystroke is not a request.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(query.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE) });
    if (search) params.set('q', search);
    if (status !== 'working') params.set('status', status);

    apiFetch<unknown>(`/patients?${params.toString()}`, { organizationId }).then(
      (raw) => {
        if (cancelled) return;
        setResult(listPatientsResponseSchema.parse(raw));
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, search, status, page]);

  const pages = result ? Math.max(1, Math.ceil(result.total / result.pageSize)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1 space-y-1.5">
          <label htmlFor="patient-search" className={ui.label}>
            {t('search')}
          </label>
          <input
            id="patient-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            className={ui.input}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="patient-status-filter" className={ui.label}>
            {t('fields.status')}
          </label>
          <select
            id="patient-status-filter"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setPage(1);
            }}
            className={ui.input}
          >
            <option value="working">{t('filter.working')}</option>
            <option value="active">{t('status.active')}</option>
            <option value="inactive">{t('status.inactive')}</option>
            <option value="archived">{t('status.archived')}</option>
          </select>
        </div>
      </div>

      {failed ? (
        <Alert tone="danger">{t('loadFailed')}</Alert>
      ) : null}

      {result === null && !failed ? <Spinner label={t('loading')} /> : null}

      {result && result.patients.length === 0 ? (
        <div className={`${ui.card} text-center`}>
          <p className={ui.muted}>{search ? t('noMatches') : t('empty')}</p>
        </div>
      ) : null}

      {result && result.patients.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface-muted text-xs uppercase tracking-wide text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">{t('fields.fullName')}</th>
              <th className="px-4 py-2.5 font-medium">{t('fields.dateOfBirth')}</th>
              <th className="px-4 py-2.5 font-medium">{t('fields.phone')}</th>
              <th className="px-4 py-2.5 font-medium">{t('fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {result.patients.map((patient) => (
              <tr key={patient.id} className="border-t border-border transition-colors duration-150 hover:bg-surface-muted/60">
                <td className="px-4 py-3">
                  <Link href={`/patients/${patient.id}`} className={ui.link}>
                    {patient.fullName}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  {patient.dateOfBirth ? formatCalendarDate(format, patient.dateOfBirth) : '—'}
                </td>
                <td className="px-4 py-3">{patient.phone ?? '—'}</td>
                <td className="px-4 py-3">
                  <Badge tone={PATIENT_STATUS_TONE[patient.status]}>{t(`status.${patient.status}`)}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      ) : null}

      {result && result.total > 0 ? (
        <div className="flex items-center justify-between text-sm text-muted">
          <span>{t('pageInfo', { page: result.page, pages, total: result.total })}</span>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className={ui.button.secondary}
            >
              {t('previous')}
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className={ui.button.secondary}
            >
              {t('next')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
