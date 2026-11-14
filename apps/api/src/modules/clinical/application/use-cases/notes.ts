import { isUniqueViolation } from '../../../../shared/db/errors';
import type { AuditTrail } from '../../../../shared/audit/audit-trail';
import type { ClinicalNote, NoteVersion } from '../../domain/clinical';
import type { ClinicalNoteRepository, ClinicalSessionRepository } from '../ports/clinical-repositories';

// F-009 / F-012. Every function here that returns note content, or writes it,
// records an audit entry in the SAME transaction before returning. Routes
// reach these only with clinicalNotes.read/write (owner, psychologist); RLS
// independently hides notes from admin_staff and refuses non-author writes.

type Deps = { sessions: ClinicalSessionRepository; notes: ClinicalNoteRepository; audit: AuditTrail };

/** Every note of a session, current version each. One audit entry per note returned. */
export async function readSessionNotes(
  input: { organizationId: string; sessionId: string; actorUserId: string },
  deps: Deps,
): Promise<ClinicalNote[] | null> {
  const session = await deps.sessions.findById(input.organizationId, input.sessionId);
  if (!session) return null;
  const notes = await deps.notes.listForSession(input.organizationId, input.sessionId);
  await deps.audit.record(
    notes.map((note) => ({
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'clinical_note.read',
      resourceType: 'clinical_note',
      resourceId: note.id,
      metadata: { version: note.version },
    })),
  );
  return notes;
}

export type OpenNoteResult =
  | { kind: 'created'; note: ClinicalNote }
  | { kind: 'session_not_found' }
  | { kind: 'patient_archived' }
  | { kind: 'already_exists' };

/** The caller starts their own note on a session (version 1). One note per author per session. */
export async function openNote(
  input: { organizationId: string; sessionId: string; authorId: string; content: string },
  deps: Deps,
): Promise<OpenNoteResult> {
  const session = await deps.sessions.findById(input.organizationId, input.sessionId);
  if (!session) return { kind: 'session_not_found' };
  if ((await deps.sessions.patientStatus(input.organizationId, session.patient.id)) === 'archived') {
    return { kind: 'patient_archived' };
  }

  let noteId: string;
  try {
    noteId = await deps.notes.open(input);
  } catch (error) {
    if (isUniqueViolation(error)) return { kind: 'already_exists' };
    throw error;
  }
  await deps.audit.record([
    {
      organizationId: input.organizationId,
      actorUserId: input.authorId,
      action: 'clinical_note.create',
      resourceType: 'clinical_note',
      resourceId: noteId,
      metadata: { version: 1 },
    },
  ]);
  const note = await deps.notes.findById(input.organizationId, noteId);
  if (!note) throw new Error('Created note is not visible');
  return { kind: 'created', note };
}

export type ReviseNoteResult =
  | { kind: 'revised'; note: ClinicalNote }
  | { kind: 'not_found' }
  | { kind: 'not_author' }
  | { kind: 'patient_archived' }
  | { kind: 'stale'; currentVersion: number };

/**
 * Adds a new version -- never an in-place edit (ADR-0006). Only the note's
 * own author, even among psychologists who can read it (ADR-0010); RLS
 * enforces the same rule on its own. `baseVersion` makes a concurrent edit
 * a visible conflict instead of a silent overwrite.
 */
export async function reviseNote(
  input: { organizationId: string; noteId: string; actorUserId: string; content: string; baseVersion: number },
  deps: Deps,
): Promise<ReviseNoteResult> {
  const note = await deps.notes.findById(input.organizationId, input.noteId);
  if (!note) return { kind: 'not_found' };
  if (note.author.userId !== input.actorUserId) return { kind: 'not_author' };
  const session = await deps.sessions.findById(input.organizationId, note.sessionId);
  if (session && (await deps.sessions.patientStatus(input.organizationId, session.patient.id)) === 'archived') {
    return { kind: 'patient_archived' };
  }
  if (note.version !== input.baseVersion) return { kind: 'stale', currentVersion: note.version };

  const version = input.baseVersion + 1;
  try {
    await deps.notes.appendVersion({
      organizationId: input.organizationId,
      noteId: input.noteId,
      authorId: input.actorUserId,
      version,
      content: input.content,
    });
  } catch (error) {
    // (clinical_note_id, version) is UNIQUE: two saves from the same base
    // cannot both land.
    if (isUniqueViolation(error)) return { kind: 'stale', currentVersion: version };
    throw error;
  }
  await deps.audit.record([
    {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'clinical_note.revise',
      resourceType: 'clinical_note',
      resourceId: input.noteId,
      metadata: { version },
    },
  ]);
  const revised = await deps.notes.findById(input.organizationId, input.noteId);
  if (!revised) throw new Error('Revised note is not visible');
  return { kind: 'revised', note: revised };
}

/** Every version of a note, oldest first ("what did it say on date X"). Audited. */
export async function readNoteHistory(
  input: { organizationId: string; noteId: string; actorUserId: string },
  deps: Deps,
): Promise<NoteVersion[] | null> {
  const note = await deps.notes.findById(input.organizationId, input.noteId);
  if (!note) return null;
  const versions = await deps.notes.history(input.organizationId, input.noteId);
  await deps.audit.record([
    {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: 'clinical_note.history_read',
      resourceType: 'clinical_note',
      resourceId: input.noteId,
      metadata: { versions: versions.length },
    },
  ]);
  return versions;
}
