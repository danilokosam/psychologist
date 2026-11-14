import {
  canRecordOutcome,
  isValidRange,
  type Appointment,
  type AppointmentChanges,
} from '../../domain/appointment';
import {
  AppointmentConflictError,
  type AppointmentRepository,
  type ConflictSide,
} from '../ports/appointment-repository';

export type ChangeResult =
  | { kind: 'updated'; appointment: Appointment }
  | { kind: 'not_found' }
  | { kind: 'cancelled' }
  | { kind: 'invalid_range' }
  | { kind: 'invalid_professional' }
  | { kind: 'not_yet_happened' }
  | { kind: 'conflict'; side: ConflictSide };

/**
 * Reschedule (new start/end on the SAME row -- F-006: one identity through
 * the lifecycle), reassign, change modality, or record the outcome.
 * Cancelled appointments are final: here (409) and in RLS (USING).
 */
export async function changeAppointment(
  input: { organizationId: string; appointmentId: string; changes: AppointmentChanges; now: Date },
  deps: { appointments: AppointmentRepository },
): Promise<ChangeResult> {
  const { organizationId, appointmentId, changes } = input;
  const existing = await deps.appointments.findById(organizationId, appointmentId);
  if (!existing) return { kind: 'not_found' };
  if (existing.status === 'cancelled') return { kind: 'cancelled' };

  // Validate the appointment as it WOULD be, so a partial change (only the
  // end, only the status) is judged against the rest of the row.
  const startsAt = changes.startsAt ?? existing.startsAt;
  const endsAt = changes.endsAt ?? existing.endsAt;
  if (!isValidRange(startsAt, endsAt)) return { kind: 'invalid_range' };
  if (!canRecordOutcome(changes.status ?? existing.status, startsAt, input.now)) {
    return { kind: 'not_yet_happened' };
  }
  if (
    changes.professionalId !== undefined &&
    changes.professionalId !== existing.professional.userId &&
    !(await deps.appointments.isActiveClinician(organizationId, changes.professionalId))
  ) {
    return { kind: 'invalid_professional' };
  }

  try {
    const updated = await deps.appointments.updateIfActive(organizationId, appointmentId, changes);
    if (!updated) return { kind: 'cancelled' };
  } catch (error) {
    if (error instanceof AppointmentConflictError) return { kind: 'conflict', side: error.side };
    throw error;
  }

  const appointment = await deps.appointments.findById(organizationId, appointmentId);
  if (!appointment) return { kind: 'not_found' };
  return { kind: 'updated', appointment };
}

export type CancelResult = { kind: 'cancelled'; appointment: Appointment } | { kind: 'not_found' } | { kind: 'already_cancelled' };

/** Frees the slot. Final: a cancelled appointment is never edited again. */
export async function cancelAppointment(
  input: { organizationId: string; appointmentId: string; now: Date },
  deps: { appointments: AppointmentRepository },
): Promise<CancelResult> {
  const changed = await deps.appointments.cancel(input.organizationId, input.appointmentId, input.now);
  const appointment = await deps.appointments.findById(input.organizationId, input.appointmentId);
  if (!appointment) return { kind: 'not_found' };
  if (!changed) return { kind: 'already_cancelled' };
  return { kind: 'cancelled', appointment };
}
