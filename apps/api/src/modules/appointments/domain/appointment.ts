import type { AppointmentModality, AppointmentStatus, EditableAppointmentStatus } from '@psych/types';

// Hand-written domain type; the Prisma adapter maps rows onto it (ADR-0009).
export type Appointment = {
  id: string;
  organizationId: string;
  patient: { id: string; fullName: string };
  professional: { userId: string; fullName: string | null };
  startsAt: Date;
  endsAt: Date;
  status: AppointmentStatus;
  modality: AppointmentModality;
  createdAt: Date;
  updatedAt: Date;
  cancelledAt: Date | null;
};

/** What an edit may change. Never the patient, organization or creator. */
export type AppointmentChanges = {
  professionalId?: string;
  startsAt?: Date;
  endsAt?: Date;
  modality?: AppointmentModality;
  status?: EditableAppointmentStatus;
};

export const MAX_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * Same rule as the appointment_time_valid CHECK, checked first so the
 * caller gets a 400 that names the problem instead of a constraint error.
 */
export function isValidRange(startsAt: Date, endsAt: Date): boolean {
  const duration = endsAt.getTime() - startsAt.getTime();
  return duration > 0 && duration <= MAX_DURATION_MS;
}

/**
 * An outcome (completed / no-show) can only be recorded for an appointment
 * that has started -- marking next week's session "completed" is a mistake,
 * and payments (Milestone 5) will trust this status.
 */
export function canRecordOutcome(status: AppointmentStatus, startsAt: Date, now: Date): boolean {
  if (status !== 'completed' && status !== 'no_show') return true;
  return startsAt.getTime() <= now.getTime();
}
