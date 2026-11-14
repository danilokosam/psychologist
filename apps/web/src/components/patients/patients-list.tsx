'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormatter, useTranslations } from 'next-intl';
import { listPatientsResponseSchema, type ListPatientsResponse, type PatientStatus } from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import { formatCalendarDate } from '@/lib/calendar-date';

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
        <div className="min-w-48 flex-1 space-y-1">
          <label htmlFor="patient-search" className="block text-sm text-zinc-700 dark:text-zinc-300">
            {t('search')}
          </label>
          <input
            id="patient-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchPlaceholder')}
            autoComplete="off"
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="patient-status-filter" className="block text-sm text-zinc-700 dark:text-zinc-300">
            {t('fields.status')}
          </label>
          <select
            id="patient-status-filter"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as StatusFilter);
              setPage(1);
            }}
            className="rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="working">{t('filter.working')}</option>
            <option value="active">{t('status.active')}</option>
            <option value="inactive">{t('status.inactive')}</option>
            <option value="archived">{t('status.archived')}</option>
          </select>
        </div>
      </div>

      {failed ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('loadFailed')}
        </p>
      ) : null}

      {result === null && !failed ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('loading')}</p> : null}

      {result && result.patients.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{search ? t('noMatches') : t('empty')}</p>
      ) : null}

      {result && result.patients.length > 0 ? (
        <table className="w-full text-left text-sm">
          <thead className="text-zinc-600 dark:text-zinc-400">
            <tr>
              <th className="py-1 font-normal">{t('fields.fullName')}</th>
              <th className="py-1 font-normal">{t('fields.dateOfBirth')}</th>
              <th className="py-1 font-normal">{t('fields.phone')}</th>
              <th className="py-1 font-normal">{t('fields.status')}</th>
            </tr>
          </thead>
          <tbody>
            {result.patients.map((patient) => (
              <tr key={patient.id} className="border-t border-zinc-200 dark:border-zinc-800">
                <td className="py-1.5">
                  <Link href={`/patients/${patient.id}`} className="font-medium underline">
                    {patient.fullName}
                  </Link>
                </td>
                <td className="py-1.5">
                  {patient.dateOfBirth ? formatCalendarDate(format, patient.dateOfBirth) : '—'}
                </td>
                <td className="py-1.5">{patient.phone ?? '—'}</td>
                <td className="py-1.5">{t(`status.${patient.status}`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {result && result.total > 0 ? (
        <div className="flex items-center justify-between text-sm text-zinc-600 dark:text-zinc-400">
          <span>{t('pageInfo', { page: result.page, pages, total: result.total })}</span>
          <div className="space-x-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="underline disabled:no-underline disabled:opacity-50"
            >
              {t('previous')}
            </button>
            <button
              type="button"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
              className="underline disabled:no-underline disabled:opacity-50"
            >
              {t('next')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
