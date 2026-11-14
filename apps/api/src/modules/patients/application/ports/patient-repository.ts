import type { PatientStatus } from '@psych/types';
import type { Patient, PatientDetails } from '../../domain/patient';

export type PatientListFilter = {
  organizationId: string;
  /** Case-insensitive substring of name, email or phone. */
  search?: string | undefined;
  /** Absent = the working list (active + inactive). */
  status?: PatientStatus | undefined;
  offset: number;
  limit: number;
};

/**
 * Persistence the patient use cases need. Every method runs inside the
 * caller's RLS transaction, so even a bug here cannot reach another
 * organization's patients (ADR-0003). `organizationId` is always passed in
 * from the verified tenant context, never from request data.
 */
export interface PatientRepository {
  insert(record: PatientDetails & { organizationId: string; createdBy: string }): Promise<Patient>;

  findById(organizationId: string, patientId: string): Promise<Patient | null>;

  list(filter: PatientListFilter): Promise<{ patients: Patient[]; total: number }>;

  /**
   * Applies `changes` only if the patient is not archived. Returns false when
   * no such editable row exists (unknown id, other organization, archived,
   * or archived concurrently).
   */
  updateIfEditable(
    organizationId: string,
    patientId: string,
    changes: Partial<PatientDetails>,
  ): Promise<boolean>;

  /** active/inactive -> archived. False if the patient was not in that state. */
  archive(organizationId: string, patientId: string, now: Date): Promise<boolean>;

  /** archived -> active. False if the patient was not archived. */
  restore(organizationId: string, patientId: string): Promise<boolean>;
}
