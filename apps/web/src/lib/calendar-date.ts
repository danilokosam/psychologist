import type { useFormatter } from 'next-intl';

/**
 * Formats a calendar date ('YYYY-MM-DD', e.g. a birth date) for the current
 * locale. Interpreted and formatted in UTC on purpose: a calendar date has no
 * time zone, and formatting it in the browser's zone would show the day
 * before for anyone west of UTC.
 */
export function formatCalendarDate(format: ReturnType<typeof useFormatter>, value: string): string {
  return format.dateTime(new Date(`${value}T00:00:00Z`), { dateStyle: 'medium', timeZone: 'UTC' });
}
