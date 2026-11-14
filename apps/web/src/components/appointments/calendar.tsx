'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useFormatter, useTranslations } from 'next-intl';
import {
  listAppointmentsResponseSchema,
  listMembersResponseSchema,
  type Appointment,
  type OrganizationMember,
} from '@psych/types';
import { apiFetch } from '@/lib/api-client';
import {
  addDays,
  sameDay,
  startOfMonth,
  step,
  toDateInput,
  viewWindow,
  type CalendarView,
} from '@/lib/calendar';

/**
 * Day / week / month calendar (F-006). Each view asks the API for exactly
 * its own window, so the browser never holds more than ~6 weeks of
 * appointments.
 */
export function Calendar({
  organizationId,
  view,
  anchor,
  professionalId,
}: {
  organizationId: string;
  view: CalendarView;
  anchor: Date;
  professionalId: string | null;
}) {
  const t = useTranslations('appointments');
  const format = useFormatter();
  const router = useRouter();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [failed, setFailed] = useState(false);
  const { from, to } = viewWindow(view, anchor);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  useEffect(() => {
    let cancelled = false;
    apiFetch<unknown>('/organizations/current/members', { organizationId }).then(
      (raw) => {
        if (!cancelled) setMembers(listMembersResponseSchema.parse(raw).members);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ from: fromIso, to: toIso });
    if (professionalId) params.set('professionalId', professionalId);
    apiFetch<unknown>(`/appointments?${params.toString()}`, { organizationId }).then(
      (raw) => {
        if (cancelled) return;
        setAppointments(listAppointmentsResponseSchema.parse(raw).appointments);
        setFailed(false);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [organizationId, fromIso, toIso, professionalId]);

  // The view state lives in the URL, so a calendar position can be
  // bookmarked, reloaded, and returned to with the back button.
  function go(next: { view?: CalendarView; anchor?: Date; professionalId?: string | null }) {
    const params = new URLSearchParams({
      view: next.view ?? view,
      date: toDateInput(next.anchor ?? anchor),
    });
    const pro = next.professionalId === undefined ? professionalId : next.professionalId;
    if (pro) params.set('professional', pro);
    router.push(`/appointments?${params.toString()}`);
  }

  const time = (date: string) => format.dateTime(new Date(date), { hour: '2-digit', minute: '2-digit' });
  const onDay = (day: Date) =>
    (appointments ?? []).filter((a) => new Date(a.startsAt) < addDays(day, 1) && new Date(a.endsAt) > day);
  const clinicians = members.filter((m) => m.role !== 'admin_staff');

  const title =
    view === 'day'
      ? format.dateTime(anchor, { dateStyle: 'full' })
      : view === 'week'
        ? `${format.dateTime(from, { day: 'numeric', month: 'short' })} – ${format.dateTime(addDays(to, -1), { day: 'numeric', month: 'short', year: 'numeric' })}`
        : format.dateTime(startOfMonth(anchor), { month: 'long', year: 'numeric' });

  const entry = (a: Appointment, compact = false) => (
    <Link
      key={a.id}
      href={`/appointments/${a.id}`}
      className={`block rounded border px-2 py-1 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
        a.status === 'confirmed' ? 'border-green-300 dark:border-green-800' : 'border-zinc-200 dark:border-zinc-700'
      }`}
    >
      <span className="font-medium">
        {time(a.startsAt)}
        {compact ? '' : `–${time(a.endsAt)}`}
      </span>{' '}
      {a.patient.fullName}
      {compact ? null : (
        <span className="block text-zinc-500 dark:text-zinc-400">
          {a.professional.fullName ?? t('unknownProfessional')} · {t(`modality.${a.modality}`)} ·{' '}
          {t(`status.${a.status}`)}
        </span>
      )}
    </Link>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <div className="flex overflow-hidden rounded border border-zinc-300 dark:border-zinc-700" role="group" aria-label={t('view')}>
          {(['day', 'week', 'month'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={v === view}
              onClick={() => go({ view: v })}
              className={`px-3 py-1 ${v === view ? 'bg-black text-white dark:bg-white dark:text-black' : 'bg-white dark:bg-zinc-900'}`}
            >
              {t(`views.${v}`)}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => go({ anchor: step(view, anchor, -1) })} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" aria-label={t('previous')}>
          ‹
        </button>
        <button type="button" onClick={() => go({ anchor: new Date() })} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700">
          {t('today')}
        </button>
        <button type="button" onClick={() => go({ anchor: step(view, anchor, 1) })} className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700" aria-label={t('next')}>
          ›
        </button>
        <h2 className="flex-1 font-medium capitalize">{title}</h2>
        <label htmlFor="calendar-professional" className="sr-only">
          {t('professional')}
        </label>
        <select
          id="calendar-professional"
          value={professionalId ?? ''}
          onChange={(event) => go({ professionalId: event.target.value || null })}
          className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">{t('allProfessionals')}</option>
          {clinicians.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.fullName ?? t('unknownProfessional')}
            </option>
          ))}
        </select>
      </div>

      {failed ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {t('loadFailed')}
        </p>
      ) : null}
      {appointments === null && !failed ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('loading')}</p> : null}

      {appointments && view === 'day' ? (
        <div className="space-y-2">
          {appointments.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-400">{t('emptyDay')}</p> : null}
          {appointments.map((a) => entry(a))}
          <Link href={`/appointments/new?date=${toDateInput(anchor)}`} className="inline-block text-sm underline">
            {t('newOnThisDay')}
          </Link>
        </div>
      ) : null}

      {appointments && view === 'week' ? (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-7">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((day) => (
            <section key={day.toISOString()} className="min-h-24 space-y-1 rounded border border-zinc-200 bg-white p-1 dark:border-zinc-800 dark:bg-zinc-900">
              <button
                type="button"
                onClick={() => go({ view: 'day', anchor: day })}
                className={`w-full text-left text-xs font-medium capitalize ${sameDay(day, new Date()) ? 'text-blue-700 dark:text-blue-400' : ''}`}
              >
                {format.dateTime(day, { weekday: 'short', day: 'numeric' })}
              </button>
              {onDay(day).map((a) => entry(a))}
            </section>
          ))}
        </div>
      ) : null}

      {appointments && view === 'month' ? (
        <div className="grid grid-cols-7 gap-1 text-xs">
          {Array.from({ length: 7 }, (_, i) => addDays(from, i)).map((day) => (
            <div key={`weekday-${day.getDay()}`} className="text-center capitalize text-zinc-500 dark:text-zinc-400">
              {format.dateTime(day, { weekday: 'short' })}
            </div>
          ))}
          {Array.from({ length: Math.round((to.getTime() - from.getTime()) / 86_400_000) }, (_, i) => addDays(from, i)).map(
            (day) => {
              const items = onDay(day);
              return (
                <section
                  key={day.toISOString()}
                  className={`min-h-20 space-y-0.5 rounded border p-1 ${
                    day.getMonth() === anchor.getMonth()
                      ? 'border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900'
                      : 'border-transparent bg-zinc-100 text-zinc-400 dark:bg-zinc-950'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => go({ view: 'day', anchor: day })}
                    className={`font-medium ${sameDay(day, new Date()) ? 'text-blue-700 dark:text-blue-400' : ''}`}
                  >
                    {day.getDate()}
                  </button>
                  {items.slice(0, 3).map((a) => entry(a, true))}
                  {items.length > 3 ? (
                    <button type="button" onClick={() => go({ view: 'day', anchor: day })} className="underline">
                      {t('more', { count: items.length - 3 })}
                    </button>
                  ) : null}
                </section>
              );
            },
          )}
        </div>
      ) : null}
    </div>
  );
}
