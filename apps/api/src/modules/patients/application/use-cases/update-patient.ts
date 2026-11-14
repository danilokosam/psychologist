import { isEditable, type Patient, type PatientDetails } from '../../domain/patient';
import type { PatientRepository } from '../ports/patient-repository';

export type UpdatePatientResult =
  | { kind: 'updated'; patient: Patient }
  | { kind: 'not_found' }
  | { kind: 'archived' };

/**
 * Edits a patient's details. Archived patients are read-only (ADR-0014): the
 * check here gives a clear 409, and the write itself is conditional on the
 * row still not being archived, so an archive that lands in between cannot
 * be overwritten. For non-owners RLS refuses archived rows independently.
 */
export async function updatePatient(
  input: { organizationId: string; patientId: string; changes: Partial<PatientDetails> },
  deps: { patients: PatientRepository },
): Promise<UpdatePatientResult> {
  const existing = await deps.patients.findById(input.organizationId, input.patientId);
  if (!existing) return { kind: 'not_found' };
  if (!isEditable(existing)) return { kind: 'archived' };

  const updated = await deps.patients.updateIfEditable(input.organizationId, input.patientId, input.changes);
  if (!updated) return { kind: 'archived' };

  const patient = await deps.patients.findById(input.organizationId, input.patientId);
  if (!patient) return { kind: 'not_found' };
  return { kind: 'updated', patient };
}
