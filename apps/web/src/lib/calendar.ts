// Calendar arithmetic in the BROWSER's time zone: a practice's day starts at
// its local midnight, not UTC's. (A per-organization time zone is a
// follow-up -- docs/ROADMAP.md.) The API always receives absolute instants.

export type CalendarView = 'day' | 'week' | 'month';

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Calendar-day arithmetic (DST-safe: uses local date parts, not 24h steps). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Weeks start on Monday (the convention in Spain and most of Europe). */
export function startOfWeek(date: Date): Date {
  const day = startOfDay(date);
  return addDays(day, -((day.getDay() + 6) % 7));
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** [from, to) the API is asked for. A month view shows whole weeks around the month. */
export function viewWindow(view: CalendarView, anchor: Date): { from: Date; to: Date } {
  if (view === 'day') {
    const from = startOfDay(anchor);
    return { from, to: addDays(from, 1) };
  }
  if (view === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 7) };
  }
  const from = startOfWeek(startOfMonth(anchor));
  const to = startOfWeek(addDays(addMonths(anchor, 1), 6));
  return { from, to };
}

export function step(view: CalendarView, anchor: Date, direction: 1 | -1): Date {
  if (view === 'day') return addDays(anchor, direction);
  if (view === 'week') return addDays(anchor, 7 * direction);
  return addMonths(anchor, direction);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 'YYYY-MM-DD' of the local date, for <input type="date"> and URLs. */
export function toDateInput(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 'HH:MM' local, for <input type="time">. */
export function toTimeInput(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Local date + time inputs -> the instant they denote in this browser's zone. */
export function fromInputs(date: string, time: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})$/.exec(time);
  if (!match || !clock) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(clock[1]), Number(clock[2]));
}

export function parseDateParam(value: string | null): Date | null {
  if (!value) return null;
  return fromInputs(value, '00:00');
}
