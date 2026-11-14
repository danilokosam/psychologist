import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import {
  addNoteVersionRequestSchema,
  clinicalNoteResponseSchema,
  clinicalSessionResponseSchema,
  createClinicalNoteRequestSchema,
  createClinicalSessionRequestSchema,
  listClinicalNotesResponseSchema,
  listClinicalSessionsQuerySchema,
  listClinicalSessionsResponseSchema,
  noteHistoryResponseSchema,
  updateClinicalSessionRequestSchema,
} from '@psych/types';
import { buildClinicalModule } from '../../../../composition/container';
import { withTenantContext } from '../../../../shared/db/tenant-context';
import { PERMISSIONS, type Permission } from '../../../../shared/authorization/permissions';
import { requireAuth } from '../../../../shared/middleware/require-auth';
import { resolveOrganization } from '../../../../shared/middleware/resolve-organization';
import { requireRole } from '../../../../shared/middleware/require-role';
import { AppError } from '../../../../shared/middleware/error-handler';
import { asyncHandler } from '../../../../shared/http/async-handler';
import { tenantContext } from '../../../../shared/http/request-context';
import type { ClinicalNote, ClinicalSession } from '../../domain/clinical';

export const clinicalRouter = Router();

const guard = (permission: Permission) =>
  [requireAuth, resolveOrganization, requireRole(PERMISSIONS[permission])] as const;

/**
 * Clinical note responses are Art. 9 health data: no browser, proxy or CDN
 * may keep a copy (the back button must not resurrect a note on a shared
 * computer after sign-out).
 */
function noStore(_req: Request, res: Response, next: NextFunction) {
  res.set('Cache-Control', 'no-store');
  next();
}

/** Malformed, unknown and other-organization ids all answer 404. */
function idParam(req: Request, name: string, what: string): string {
  const id = z.uuid().safeParse(req.params[name]);
  if (!id.success) throw new AppError(404, `${what} not found`, 'NOT_FOUND');
  return id.data;
}

function sessionResponse(session: ClinicalSession) {
  return {
    id: session.id,
    patient: session.patient,
    professional: session.professional,
    appointmentId: session.appointmentId,
    startedAt: session.startedAt.toISOString(),
    durationMinutes: session.durationMinutes,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
  };
}

function noteResponse(note: ClinicalNote) {
  return {
    id: note.id,
    sessionId: note.sessionId,
    author: note.author,
    version: note.version,
    content: note.content,
    createdAt: note.createdAt.toISOString(),
    updatedAt: note.updatedAt.toISOString(),
  };
}

// ---- Sessions (F-008): metadata, readable by every role ----------------

clinicalRouter.get(
  '/clinical-sessions',
  ...guard('clinicalSessions.read'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const query = listClinicalSessionsQuerySchema.safeParse(req.query);
    if (!query.success) throw new AppError(400, 'Invalid query parameters', 'BAD_REQUEST');
    const { page, pageSize } = query.data;
    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildClinicalModule(tx).listSessions({
        organizationId,
        patientId: query.data.patientId,
        appointmentId: query.data.appointmentId,
        page,
        pageSize,
      }),
    );
    res.json(
      listClinicalSessionsResponseSchema.parse({
        sessions: result.sessions.map(sessionResponse),
        page,
        pageSize,
        total: result.total,
      }),
    );
  }),
);

clinicalRouter.post(
  '/clinical-sessions',
  ...guard('clinicalSessions.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const body = createClinicalSessionRequestSchema.safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildClinicalModule(tx).recordSession({
        organizationId,
        createdBy: userId,
        patientId: body.data.patientId,
        professionalId: body.data.professionalId,
        appointmentId: body.data.appointmentId ?? null,
        startedAt: new Date(body.data.startedAt),
        durationMinutes: body.data.durationMinutes,
        now: new Date(),
      }),
    );
    switch (result.kind) {
      case 'recorded':
        res.status(201).json(clinicalSessionResponseSchema.parse({ session: sessionResponse(result.session) }));
        return;
      case 'invalid_patient':
        throw new AppError(422, 'Unknown patient', 'INVALID_PATIENT');
      case 'patient_archived':
        throw new AppError(422, 'The patient is archived', 'PATIENT_ARCHIVED');
      case 'invalid_professional':
        throw new AppError(422, 'The professional must be an active owner or psychologist', 'INVALID_PROFESSIONAL');
      case 'in_future':
      case 'appointment_not_started':
        throw new AppError(422, 'A session can only be recorded once it has started', 'NOT_YET_HAPPENED');
      case 'invalid_appointment':
        throw new AppError(422, 'Unknown appointment for this patient', 'INVALID_APPOINTMENT');
      case 'appointment_cancelled':
        throw new AppError(422, 'The appointment was cancelled', 'APPOINTMENT_CANCELLED');
      case 'already_recorded':
        throw new AppError(409, 'A session is already recorded for this appointment', 'SESSION_ALREADY_RECORDED');
    }
  }),
);

clinicalRouter.get(
  '/clinical-sessions/:sessionId',
  ...guard('clinicalSessions.read'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const sessionId = idParam(req, 'sessionId', 'Session');
    const session = await withTenantContext({ userId, organizationId }, (tx) =>
      buildClinicalModule(tx).getSession({ organizationId, sessionId }),
    );
    if (!session) throw new AppError(404, 'Session not found', 'NOT_FOUND');
    res.json(clinicalSessionResponseSchema.parse({ session: sessionResponse(session) }));
  }),
);

clinicalRouter.patch(
  '/clinical-sessions/:sessionId',
  ...guard('clinicalSessions.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const sessionId = idParam(req, 'sessionId', 'Session');
    const body = updateClinicalSessionRequestSchema.safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    const changes: { startedAt?: Date; durationMinutes?: number } = {};
    if (body.data.startedAt !== undefined) changes.startedAt = new Date(body.data.startedAt);
    if (body.data.durationMinutes !== undefined) changes.durationMinutes = body.data.durationMinutes;
    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildClinicalModule(tx).correctSession({
        organizationId,
        sessionId,
        changes,
        now: new Date(),
      }),
    );
    if (result.kind === 'not_found') throw new AppError(404, 'Session not found', 'NOT_FOUND');
    if (result.kind === 'in_future') {
      throw new AppError(422, 'A session can only be recorded once it has started', 'NOT_YET_HAPPENED');
    }
    res.json(clinicalSessionResponseSchema.parse({ session: sessionResponse(result.session) }));
  }),
);

// ---- Notes (F-009, F-012): clinicians only, every access audited --------

clinicalRouter.get(
  '/clinical-sessions/:sessionId/notes',
  noStore,
  ...guard('clinicalNotes.read'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const sessionId = idParam(req, 'sessionId', 'Session');
    const notes = await withTenantContext({ userId, organizationId }, (tx) =>
      buildClinicalModule(tx).readSessionNotes({
        organizationId,
        sessionId,
        actorUserId: userId,
      }),
    );
    if (!notes) throw new AppError(404, 'Session not found', 'NOT_FOUND');
    res.json(listClinicalNotesResponseSchema.parse({ notes: notes.map(noteResponse) }));
  }),
);

clinicalRouter.post(
  '/clinical-sessions/:sessionId/notes',
  noStore,
  ...guard('clinicalNotes.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const sessionId = idParam(req, 'sessionId', 'Session');
    const body = createClinicalNoteRequestSchema.safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildClinicalModule(tx).openNote({
        organizationId,
        sessionId,
        authorId: userId,
        content: body.data.content,
      }),
    );
    if (result.kind === 'session_not_found') throw new AppError(404, 'Session not found', 'NOT_FOUND');
    if (result.kind === 'patient_archived') throw new AppError(422, 'The patient is archived', 'PATIENT_ARCHIVED');
    if (result.kind === 'already_exists') {
      throw new AppError(409, 'You already have a note on this session; add a version to it', 'NOTE_EXISTS');
    }
    res.status(201).json(clinicalNoteResponseSchema.parse({ note: noteResponse(result.note) }));
  }),
);

clinicalRouter.post(
  '/clinical-notes/:noteId/versions',
  noStore,
  ...guard('clinicalNotes.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const noteId = idParam(req, 'noteId', 'Note');
    const body = addNoteVersionRequestSchema.safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildClinicalModule(tx).reviseNote({
        organizationId,
        noteId,
        actorUserId: userId,
        content: body.data.content,
        baseVersion: body.data.baseVersion,
      }),
    );
    switch (result.kind) {
      case 'revised':
        res.status(201).json(clinicalNoteResponseSchema.parse({ note: noteResponse(result.note) }));
        return;
      case 'not_found':
        throw new AppError(404, 'Note not found', 'NOT_FOUND');
      // The caller can read this note (same practice, clinical role), so a
      // 403 reveals nothing; only its author may write to it (ADR-0010).
      case 'not_author':
        throw new AppError(403, 'Only the author of a clinical note can add a version', 'NOT_NOTE_AUTHOR');
      case 'patient_archived':
        throw new AppError(422, 'The patient is archived', 'PATIENT_ARCHIVED');
      case 'stale':
        throw new AppError(409, `The note has changed since (now at version ${result.currentVersion})`, 'NOTE_STALE');
    }
  }),
);

clinicalRouter.get(
  '/clinical-notes/:noteId/versions',
  noStore,
  ...guard('clinicalNotes.read'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const noteId = idParam(req, 'noteId', 'Note');
    const versions = await withTenantContext({ userId, organizationId }, (tx) =>
      buildClinicalModule(tx).readNoteHistory({
        organizationId,
        noteId,
        actorUserId: userId,
      }),
    );
    if (!versions) throw new AppError(404, 'Note not found', 'NOT_FOUND');
    res.json(
      noteHistoryResponseSchema.parse({
        versions: versions.map((v) => ({
          version: v.version,
          content: v.content,
          createdAt: v.createdAt.toISOString(),
          createdBy: v.createdBy,
        })),
      }),
    );
  }),
);
