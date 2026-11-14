import type { Patient, PatientDetails } from '../../domain/patient';
import type { PatientRepository } from '../ports/patient-repository';

/**
 * Registers a patient in the caller's organization. `organizationId` and
 * `createdBy` come from the verified tenant context; the route never lets
 * them come from the body (the request schema cannot even represent them).
 */
export function createPatient(
  input: { organizationId: string; createdBy: string; details: PatientDetails },
  deps: { patients: PatientRepository },
): Promise<Patient> {
  return deps.patients.insert({
    ...input.details,
    organizationId: input.organizationId,
    createdBy: input.createdBy,
  });
}
