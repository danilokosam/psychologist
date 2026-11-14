import type { Patient } from '../../domain/patient';
import type { PatientRepository } from '../ports/patient-repository';

export type ArchiveResult =
  | { kind: 'done'; patient: Patient }
  | { kind: 'not_found' }
  | { kind: 'conflict' };

/**
 * Owner-only (route: patients.archive; RLS: has_active_role 'owner'). Archive
 * replaces deletion: the record is kept, hidden from the working list and
 * read-only. Hard erasure is deliberately not built -- it depends on the
 * clinical-record retention period, an open legal question (ADR-0014).
 */
export function archivePatient(
  input: { organizationId: string; patientId: string; now: Date },
  deps: { patients: PatientRepository },
): Promise<ArchiveResult> {
  return transition(input, deps, () =>
    deps.patients.archive(input.organizationId, input.patientId, input.now),
  );
}

/** Owner-only inverse of archivePatient. The patient comes back as active. */
export function restorePatient(
  input: { organizationId: string; patientId: string },
  deps: { patients: PatientRepository },
): Promise<ArchiveResult> {
  return transition(input, deps, () => deps.patients.restore(input.organizationId, input.patientId));
}

async function transition(
  input: { organizationId: string; patientId: string },
  deps: { patients: PatientRepository },
  apply: () => Promise<boolean>,
): Promise<ArchiveResult> {
  const changed = await apply();
  const patient = await deps.patients.findById(input.organizationId, input.patientId);
  if (!patient) return { kind: 'not_found' };
  // Already in the target state (or raced into it): a conflict, not a no-op
  // success, so the UI can tell the user the list they see is stale.
  if (!changed) return { kind: 'conflict' };
  return { kind: 'done', patient };
}
