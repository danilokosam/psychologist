import type { ReactNode } from 'react';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const BADGE: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-muted',
  primary: 'bg-primary-soft text-primary-soft-foreground',
  success: 'bg-success-soft text-success',
  warning: 'bg-warning-soft text-warning',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

/** A small colored pill for a status (patient, appointment, invitation). */
export function Badge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${BADGE[tone]}`}>
      {children}
    </span>
  );
}

/**
 * Inline message. Errors use role="alert" so screen readers announce them;
 * confirmations use role="status" (announced politely).
 */
export function Alert({ tone, children }: { tone: 'success' | 'danger' | 'info'; children: ReactNode }) {
  const colors = {
    success: 'border-success/30 bg-success-soft text-success',
    danger: 'border-danger/30 bg-danger-soft text-danger',
    info: 'border-info/30 bg-info-soft text-info',
  }[tone];
  return (
    <p role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2 text-sm ${colors}`}>
      {children}
    </p>
  );
}

/** The one looping animation in the app: shown only while waiting on the API. */
export function Spinner({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-border-strong border-t-primary"
      />
      {label}
    </p>
  );
}

export const PATIENT_STATUS_TONE = { active: 'success', inactive: 'neutral', archived: 'warning' } as const;

export const APPOINTMENT_STATUS_TONE = {
  scheduled: 'info',
  confirmed: 'success',
  completed: 'primary',
  cancelled: 'neutral',
  no_show: 'danger',
} as const;
