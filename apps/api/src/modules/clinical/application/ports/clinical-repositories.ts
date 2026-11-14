import type { AppointmentStatus, PatientStatus } from '@psych/types';
import type { ClinicalNote, ClinicalSession, NoteVersion } from '../../domain/clinical';

/** Every method runs in the caller's RLS transaction (ADR-0003). */
export interface ClinicalSessionRepository {
  findById(organizationId: string, sessionId: string): Promise<ClinicalSession | null>;

  listForPatient(
    organizationId: string,
    filter: { patientId?: string | undefined; appointmentId?: string | undefined; offset: number; limit: number },
  ): Promise<{ sessions: ClinicalSession[]; total: number }>;

  /** @throws on a second session for the same appointment (unique violation). */
  insert(record: {
    organizationId: string;
    createdBy: string;
    patientId: string;
    professionalId: string;
    appointmentId: string | null;
    startedAt: Date;
    durationMinutes: number;
  }): Promise<string>;

  update(
    organizationId: string,
    sessionId: string,
    changes: { startedAt?: Date; durationMinutes?: number },
  ): Promise<boolean>;

  patientStatus(organizationId: string, patientId: string): Promise<PatientStatus | null>;
  isActiveClinician(organizationId: string, userId: string): Promise<boolean>;
  findAppointment(
    organizationId: string,
    appointmentId: string,
  ): Promise<{ patientId: string; professionalId: string; status: AppointmentStatus; startsAt: Date } | null>;
  /** scheduled/confirmed -> completed, once the session has been recorded. */
  markAppointmentCompleted(organizationId: string, appointmentId: string): Promise<void>;
}

export interface ClinicalNoteRepository {
  listForSession(organizationId: string, sessionId: string): Promise<ClinicalNote[]>;
  findById(organizationId: string, noteId: string): Promise<ClinicalNote | null>;
  /** Creates the note and its version 1. @throws on a second note by the same author for the session. */
  open(record: { organizationId: string; sessionId: string; authorId: string; content: string }): Promise<string>;
  /** Appends a version. @throws if `version` already exists (a concurrent edit won). */
  appendVersion(record: { organizationId: string; noteId: string; authorId: string; version: number; content: string }): Promise<void>;
  history(organizationId: string, noteId: string): Promise<NoteVersion[]>;
}
