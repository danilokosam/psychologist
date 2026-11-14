import type { AppointmentModality } from '@psych/types';
import type { Appointment, AppointmentChanges } from '../../domain/appointment';

export type AppointmentWindow = {
  organizationId: string;
  from: Date;
  to: Date;
  professionalId?: string | undefined;
  patientId?: string | undefined;
  includeCancelled: boolean;
};

/** Which side of an exclusion constraint a write ran into (F-007). */
export type ConflictSide = 'professional' | 'patient';

/**
 * Thrown by the adapter when the database's exclusion constraint rejects a
 * write. The constraint -- not any pre-check -- is the guarantee against
 * double-booking; this just tells the use case which side collided.
 */
export class AppointmentConflictError extends Error {
  constructor(public readonly side: ConflictSide) {
    super(`Appointment overlaps another for the same ${side}`);
  }
}

/**
 * Persistence the appointment use cases need, always inside the caller's RLS
 * transaction and always given `organizationId` from the verified tenant
 * context (ADR-0003).
 */
export interface AppointmentRepository {
  findById(organizationId: string, appointmentId: string): Promise<Appointment | null>;

  /** Appointments overlapping [from, to), by start time. */
  listInWindow(window: AppointmentWindow): Promise<Appointment[]>;

  /** @throws AppointmentConflictError */
  insert(record: {
    organizationId: string;
    createdBy: string;
    patientId: string;
    professionalId: string;
    startsAt: Date;
    endsAt: Date;
    modality: AppointmentModality;
    status: 'scheduled' | 'confirmed';
  }): Promise<string>;

  /**
   * Applies `changes` unless the appointment is cancelled. False when no such
   * row (unknown, other organization, or cancelled meanwhile).
   * @throws AppointmentConflictError
   */
  updateIfActive(organizationId: string, appointmentId: string, changes: AppointmentChanges): Promise<boolean>;

  /** Any non-cancelled status -> cancelled. False if already cancelled / unknown. */
  cancel(organizationId: string, appointmentId: string, now: Date): Promise<boolean>;

  /** Status of a patient in this organization, or null if there is none. */
  patientStatus(organizationId: string, patientId: string): Promise<'active' | 'inactive' | 'archived' | null>;

  /** Whether the user is an active owner/psychologist of this organization. */
  isActiveClinician(organizationId: string, userId: string): Promise<boolean>;
}
