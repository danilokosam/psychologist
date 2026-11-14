import type { AppointmentModality } from '@psych/types';
import { isValidRange, type Appointment } from '../../domain/appointment';
import {
  AppointmentConflictError,
  type AppointmentRepository,
  type ConflictSide,
} from '../ports/appointment-repository';

export type ScheduleResult =
  | { kind: 'created'; appointment: Appointment }
  | { kind: 'invalid_range' }
  | { kind: 'invalid_patient' }
  | { kind: 'patient_archived' }
  | { kind: 'invalid_professional' }
  | { kind: 'conflict'; side: ConflictSide };

/**
 * Books an appointment. The checks here produce precise errors; every one of
 * them is enforced again by the database independently -- composite FKs
 * (same organization), the insert policy (clinician, non-archived patient)
 * and the exclusion constraints (no overlap, F-007).
 */
export async function scheduleAppointment(
  input: {
    organizationId: string;
    createdBy: string;
    patientId: string;
    professionalId: string;
    startsAt: Date;
    endsAt: Date;
    modality: AppointmentModality;
    status: 'scheduled' | 'confirmed';
  },
  deps: { appointments: AppointmentRepository },
): Promise<ScheduleResult> {
  if (!isValidRange(input.startsAt, input.endsAt)) return { kind: 'invalid_range' };

  const patient = await deps.appointments.patientStatus(input.organizationId, input.patientId);
  if (patient === null) return { kind: 'invalid_patient' };
  if (patient === 'archived') return { kind: 'patient_archived' };

  if (!(await deps.appointments.isActiveClinician(input.organizationId, input.professionalId))) {
    return { kind: 'invalid_professional' };
  }

  try {
    const id = await deps.appointments.insert(input);
    const appointment = await deps.appointments.findById(input.organizationId, id);
    if (!appointment) throw new Error('Inserted appointment is not visible');
    return { kind: 'created', appointment };
  } catch (error) {
    if (error instanceof AppointmentConflictError) return { kind: 'conflict', side: error.side };
    throw error;
  }
}
