import type { PatientStatus } from '@psych/types';
import type { Patient } from '../../domain/patient';
import type { PatientRepository } from '../ports/patient-repository';

export function getPatient(
  input: { organizationId: string; patientId: string },
  deps: { patients: PatientRepository },
): Promise<Patient | null> {
  return deps.patients.findById(input.organizationId, input.patientId);
}

/** One page of the organization's patients, ordered by name. */
export async function listPatients(
  input: {
    organizationId: string;
    search?: string | undefined;
    status?: PatientStatus | undefined;
    page: number;
    pageSize: number;
  },
  deps: { patients: PatientRepository },
): Promise<{ patients: Patient[]; total: number }> {
  const search = input.search?.trim();
  return deps.patients.list({
    organizationId: input.organizationId,
    search: search ? search : undefined,
    status: input.status,
    offset: (input.page - 1) * input.pageSize,
    limit: input.pageSize,
  });
}
