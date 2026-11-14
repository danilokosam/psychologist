import { isUniqueViolation } from '../../../../shared/db/errors';
import { isInFuture, type ClinicalSession } from '../../domain/clinical';
import type { ClinicalSessionRepository } from '../ports/clinical-repositories';

export type RecordSessionResult =
  | { kind: 'recorded'; session: ClinicalSession }
  | { kind: 'invalid_patient' }
  | { kind: 'patient_archived' }
  | { kind: 'invalid_professional' }
  | { kind: 'in_future' }
  | { kind: 'invalid_appointment' }
  | { kind: 'appointment_cancelled' }
  | { kind: 'appointment_not_started' }
  | { kind: 'already_recorded' };

/**
 * Records that a clinical encounter took place (F-008). Only clinicians reach
 * this (route: clinicalSessions.write); RLS re-checks the caller's role, the
 * professional, and the patient independently. Linking an appointment also
 * marks it completed, in the same transaction.
 */
export async function recordSession(
  input: {
    organizationId: string;
    createdBy: string;
    patientId: string;
    professionalId: string;
    appointmentId: string | null;
    startedAt: Date;
    durationMinutes: number;
    now: Date;
  },
  deps: { sessions: ClinicalSessionRepository },
): Promise<RecordSessionResult> {
  const { sessions } = deps;
  const patient = await sessions.patientStatus(input.organizationId, input.patientId);
  if (patient === null) return { kind: 'invalid_patient' };
  if (patient === 'archived') return { kind: 'patient_archived' };
  if (!(await sessions.isActiveClinician(input.organizationId, input.professionalId))) {
    return { kind: 'invalid_professional' };
  }
  if (isInFuture(input.startedAt, input.now)) return { kind: 'in_future' };

  let completeAppointment = false;
  if (input.appointmentId) {
    const appointment = await sessions.findAppointment(input.organizationId, input.appointmentId);
    // An appointment of another patient is refused like an unknown one (the
    // composite FK would refuse it anyway).
    if (!appointment || appointment.patientId !== input.patientId) return { kind: 'invalid_appointment' };
    if (appointment.status === 'cancelled') return { kind: 'appointment_cancelled' };
    if (isInFuture(appointment.startsAt, input.now)) return { kind: 'appointment_not_started' };
    completeAppointment =
      (appointment.status === 'scheduled' || appointment.status === 'confirmed') &&
      (await sessions.isActiveClinician(input.organizationId, appointment.professionalId));
  }

  let id: string;
  try {
    id = await sessions.insert({ ...input, appointmentId: input.appointmentId });
  } catch (error) {
    // appointment_id is UNIQUE: one session per appointment, even when two
    // clinicians record it at the same moment.
    if (isUniqueViolation(error)) return { kind: 'already_recorded' };
    throw error;
  }
  if (completeAppointment && input.appointmentId) {
    await sessions.markAppointmentCompleted(input.organizationId, input.appointmentId);
  }

  const session = await sessions.findById(input.organizationId, id);
  if (!session) throw new Error('Recorded session is not visible');
  return { kind: 'recorded', session };
}

export type CorrectSessionResult =
  | { kind: 'updated'; session: ClinicalSession }
  | { kind: 'not_found' }
  | { kind: 'in_future' };

/** Corrects the time facts of a session. Patient, professional and appointment never change. */
export async function correctSession(
  input: {
    organizationId: string;
    sessionId: string;
    changes: { startedAt?: Date; durationMinutes?: number };
    now: Date;
  },
  deps: { sessions: ClinicalSessionRepository },
): Promise<CorrectSessionResult> {
  if (input.changes.startedAt && isInFuture(input.changes.startedAt, input.now)) return { kind: 'in_future' };
  const updated = await deps.sessions.update(input.organizationId, input.sessionId, input.changes);
  if (!updated) return { kind: 'not_found' };
  const session = await deps.sessions.findById(input.organizationId, input.sessionId);
  return session ? { kind: 'updated', session } : { kind: 'not_found' };
}

export function getSession(
  input: { organizationId: string; sessionId: string },
  deps: { sessions: ClinicalSessionRepository },
): Promise<ClinicalSession | null> {
  return deps.sessions.findById(input.organizationId, input.sessionId);
}

export function listSessions(
  input: {
    organizationId: string;
    patientId?: string | undefined;
    appointmentId?: string | undefined;
    page: number;
    pageSize: number;
  },
  deps: { sessions: ClinicalSessionRepository },
): Promise<{ sessions: ClinicalSession[]; total: number }> {
  return deps.sessions.listForPatient(input.organizationId, {
    patientId: input.patientId,
    appointmentId: input.appointmentId,
    offset: (input.page - 1) * input.pageSize,
    limit: input.pageSize,
  });
}
