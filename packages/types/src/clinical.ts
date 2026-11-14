import { z } from 'zod';

// F-008 (sessions), F-009 (notes), ADR-0016. Note content is GDPR Art. 9
// health data: never log it, never put it in the audit trail.

const instant = z.iso.datetime({ offset: true });

/** Same bound as the clinical_sessions_duration_valid CHECK. */
export const SESSION_MAX_MINUTES = 720;
/** Same bound as the clinical_note_versions_content_valid CHECK. */
export const NOTE_MAX_CHARS = 50_000;

const person = z.object({ userId: z.uuid(), fullName: z.string().nullable() });

export const clinicalSessionSchema = z.object({
  id: z.uuid(),
  patient: z.object({ id: z.uuid(), fullName: z.string() }),
  professional: person,
  appointmentId: z.uuid().nullable(),
  startedAt: z.iso.datetime(),
  durationMinutes: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ClinicalSession = z.infer<typeof clinicalSessionSchema>;

// Strict: no organizationId / createdBy -- they come from the verified
// tenant context. Recording from an appointment links the two (one session
// per appointment) and marks the appointment completed.
export const createClinicalSessionRequestSchema = z.strictObject({
  patientId: z.uuid(),
  professionalId: z.uuid(),
  appointmentId: z.uuid().optional(),
  startedAt: instant,
  durationMinutes: z.number().int().min(1).max(SESSION_MAX_MINUTES),
});
export type CreateClinicalSessionRequest = z.infer<typeof createClinicalSessionRequestSchema>;

// Only the time facts can be corrected; patient, professional and the
// appointment link are fixed once recorded.
export const updateClinicalSessionRequestSchema = z
  .strictObject({
    startedAt: instant,
    durationMinutes: z.number().int().min(1).max(SESSION_MAX_MINUTES),
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdateClinicalSessionRequest = z.infer<typeof updateClinicalSessionRequestSchema>;

// A patient's history (newest first) or the session of one appointment.
export const listClinicalSessionsQuerySchema = z
  .strictObject({
    patientId: z.uuid().optional(),
    appointmentId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine((q) => q.patientId !== undefined || q.appointmentId !== undefined, {
    message: 'patientId or appointmentId is required',
  });
export type ListClinicalSessionsQuery = z.infer<typeof listClinicalSessionsQuerySchema>;

export const listClinicalSessionsResponseSchema = z.object({
  sessions: z.array(clinicalSessionSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type ListClinicalSessionsResponse = z.infer<typeof listClinicalSessionsResponseSchema>;

export const clinicalSessionResponseSchema = z.object({ session: clinicalSessionSchema });
export type ClinicalSessionResponse = z.infer<typeof clinicalSessionResponseSchema>;

// Content is stored exactly as written -- no trimming of clinical text --
// but must not be blank.
const noteContent = z
  .string()
  .max(NOTE_MAX_CHARS)
  .refine((value) => value.trim().length > 0, { message: 'Note is empty' });

export const createClinicalNoteRequestSchema = z.strictObject({ content: noteContent });
export type CreateClinicalNoteRequest = z.infer<typeof createClinicalNoteRequestSchema>;

// `baseVersion`: the version the author was editing. If the note has moved
// on since (another tab, another device), the write is refused with 409
// instead of silently replacing text the author has not seen.
export const addNoteVersionRequestSchema = z.strictObject({
  content: noteContent,
  baseVersion: z.number().int().min(1),
});
export type AddNoteVersionRequest = z.infer<typeof addNoteVersionRequestSchema>;

export const clinicalNoteSchema = z.object({
  id: z.uuid(),
  sessionId: z.uuid(),
  author: person,
  /** The current (highest) version. */
  version: z.number().int(),
  content: z.string(),
  createdAt: z.iso.datetime(),
  /** When the current version was written. */
  updatedAt: z.iso.datetime(),
});
export type ClinicalNote = z.infer<typeof clinicalNoteSchema>;

export const listClinicalNotesResponseSchema = z.object({ notes: z.array(clinicalNoteSchema) });
export type ListClinicalNotesResponse = z.infer<typeof listClinicalNotesResponseSchema>;

export const clinicalNoteResponseSchema = z.object({ note: clinicalNoteSchema });
export type ClinicalNoteResponse = z.infer<typeof clinicalNoteResponseSchema>;

export const noteVersionSchema = z.object({
  version: z.number().int(),
  content: z.string(),
  createdAt: z.iso.datetime(),
  createdBy: person,
});
export type NoteVersion = z.infer<typeof noteVersionSchema>;

export const noteHistoryResponseSchema = z.object({ versions: z.array(noteVersionSchema) });
export type NoteHistoryResponse = z.infer<typeof noteHistoryResponseSchema>;
