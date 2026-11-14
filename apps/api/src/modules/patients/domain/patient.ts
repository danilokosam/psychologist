import type { EditablePatientStatus, PatientStatus } from '@psych/types';

// Hand-written domain type; the Prisma adapter maps rows onto it (ADR-0009).
// `dateOfBirth` is a calendar date (YYYY-MM-DD), never a Date object: a birth
// date has no time zone, and a Date would shift it by one day for anyone
// west of UTC.
export type Patient = {
  id: string;
  organizationId: string;
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  status: PatientStatus;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
};

/** The fields a create or edit may set. Never organization, creator or archive state. */
export type PatientDetails = {
  fullName: string;
  dateOfBirth: string | null;
  email: string | null;
  phone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  status: EditablePatientStatus;
};

/**
 * An archived patient is read-only until an owner restores it (ADR-0014): the
 * archive is where a former patient's record waits out its retention period,
 * not a second working list.
 */
export function isEditable(patient: Pick<Patient, 'status'>): boolean {
  return patient.status !== 'archived';
}
