import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/shared/db/prisma';
import {
  adminDb,
  asIdentity,
  bootstrapUser,
  inviteMember,
  makeUser,
  resetDatabase,
  runtimeDb,
  type TestUser,
} from './helpers';

/**
 * Milestone 4 (F-008 sessions, F-009 notes, F-012 audit; ADR-0006/0016).
 * Definition of done:
 *   - an audit entry for every note read and write, verified here;
 *   - admin_staff blocked from notes BY RLS ALONE (app layer removed);
 *   - a non-author psychologist blocked from writing BY RLS ALONE.
 *
 *   Org A: ownerA (owner), psychA (psychologist, the note author),
 *          psychA2 (psychologist, NOT the author), staffA (admin_staff)
 *   Org B: ownerB (owner) -- the outsider
 *
 * All content is synthetic.
 */

const app = createApp();
const RLS_VIOLATION = /row-level security/;
const PERMISSION_DENIED = /permission denied/;
const NOTE_V1 = 'Synthetic note v1: patient reports improved sleep (TEST).';
const NOTE_V2 = 'Synthetic note v2: patient reports improved sleep; plan unchanged (TEST).';

type Member = TestUser & { organizationId: string };
let ownerA: Member;
let ownerB: Member;
let psychA: TestUser;
let psychA2: TestUser;
let staffA: TestUser;
let orgA: string;
let orgB: string;
let patientA: string;
let otherPatientA: string;
let patientB: string;

const as = (user: TestUser, organizationId: string) => {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${user.token}`).set('X-Organization-Id', organizationId);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body: object = {}) => auth(request(app).post(path)).send(body),
    patch: (path: string, body: object) => auth(request(app).patch(path)).send(body),
  };
};

const PAST = '2026-01-12T09:00:00.000Z';

async function createPatient(user: TestUser, organizationId: string, fullName: string): Promise<string> {
  const r = await as(user, organizationId).post('/patients', { fullName });
  if (r.status !== 201) throw new Error(`patient: ${r.status}`);
  return r.body.patient.id;
}

async function recordSession(user: TestUser, body: Record<string, unknown> = {}): Promise<string> {
  const r = await as(user, orgA).post('/clinical-sessions', {
    patientId: patientA,
    professionalId: psychA.id,
    startedAt: PAST,
    durationMinutes: 50,
    ...body,
  });
  if (r.status !== 201) throw new Error(`session: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.session.id;
}

const auditFor = (resourceId: string) =>
  adminDb.auditLog.findMany({ where: { resourceId }, orderBy: { createdAt: 'asc' } });

beforeAll(async () => {
  await resetDatabase();
  ownerA = await bootstrapUser(app, 'owner-a');
  ownerB = await bootstrapUser(app, 'owner-b');
  orgA = ownerA.organizationId;
  orgB = ownerB.organizationId;
  psychA = await makeUser('psych-a');
  psychA2 = await makeUser('psych-a2');
  staffA = await makeUser('staff-a');
  await inviteMember(app, ownerA, 'psychologist', psychA);
  await inviteMember(app, ownerA, 'psychologist', psychA2);
  await inviteMember(app, ownerA, 'admin_staff', staffA);
  patientA = await createPatient(ownerA, orgA, 'Clinical Patient A');
  otherPatientA = await createPatient(ownerA, orgA, 'Clinical Other Patient A');
  patientB = await createPatient(ownerB, orgB, 'Clinical Patient B');
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), runtimeDb.$disconnect()]);
});

describe('clinical sessions (F-008) — full stack', () => {
  it.each([
    ['owner', () => ownerA],
    ['psychologist', () => psychA],
  ])('%s can record and correct a session', async (_role, who) => {
    const created = await as(who(), orgA).post('/clinical-sessions', {
      patientId: patientA,
      professionalId: psychA.id,
      startedAt: '2026-02-02T10:00:00Z',
      durationMinutes: 50,
    });
    expect(created.status).toBe(201);
    expect(created.body.session).toMatchObject({
      patient: { id: patientA, fullName: 'Clinical Patient A' },
      professional: { userId: psychA.id, fullName: 'Synthetic psych-a' },
      appointmentId: null,
      durationMinutes: 50,
    });
    const fixed = await as(who(), orgA).patch(`/clinical-sessions/${created.body.session.id}`, { durationMinutes: 45 });
    expect(fixed.status).toBe(200);
    expect(fixed.body.session.durationMinutes).toBe(45);
  });

  it('admin_staff reads session metadata but cannot record or correct one (403)', async () => {
    const id = await recordSession(psychA);
    const read = await as(staffA, orgA).get(`/clinical-sessions/${id}`);
    expect(read.status).toBe(200);
    expect(Object.keys(read.body.session).sort()).toEqual(
      ['appointmentId', 'createdAt', 'durationMinutes', 'id', 'patient', 'professional', 'startedAt', 'updatedAt'].sort(),
    );
    expect((await as(staffA, orgA).get(`/clinical-sessions?patientId=${patientA}`)).status).toBe(200);
    expect(
      (await as(staffA, orgA).post('/clinical-sessions', { patientId: patientA, professionalId: psychA.id, startedAt: PAST, durationMinutes: 50 }))
        .status,
    ).toBe(403);
    expect((await as(staffA, orgA).patch(`/clinical-sessions/${id}`, { durationMinutes: 10 })).status).toBe(403);
  });

  it.each([
    ['a future start', { startedAt: '2999-01-01T00:00:00Z' }, 422, 'NOT_YET_HAPPENED'],
    ['admin_staff as professional', { professionalId: 'STAFF' }, 422, 'INVALID_PROFESSIONAL'],
    ['another organization’s patient', { patientId: 'PATIENT_B' }, 422, 'INVALID_PATIENT'],
    ['a zero duration', { durationMinutes: 0 }, 400, 'BAD_REQUEST'],
    ['over 12 hours', { durationMinutes: 721 }, 400, 'BAD_REQUEST'],
    ['organizationId in the body', { organizationId: 'ORG_B' }, 400, 'BAD_REQUEST'],
  ])('refuses %s', async (_label, override, status, code) => {
    const swap = (v: unknown) => (v === 'STAFF' ? staffA.id : v === 'PATIENT_B' ? patientB : v === 'ORG_B' ? orgB : v);
    const body = Object.fromEntries(
      Object.entries({ patientId: patientA, professionalId: psychA.id, startedAt: PAST, durationMinutes: 50, ...override }).map(
        ([k, v]) => [k, swap(v)],
      ),
    );
    const r = await as(psychA, orgA).post('/clinical-sessions', body);
    expect(r.status).toBe(status);
    expect(r.body.error.code).toBe(code);
  });

  it('only start time and duration can be corrected', async () => {
    const id = await recordSession(psychA);
    for (const body of [{ patientId: otherPatientA }, { professionalId: ownerA.id }, { appointmentId: patientA }]) {
      expect((await as(psychA, orgA).patch(`/clinical-sessions/${id}`, body)).status).toBe(400);
    }
  });

  describe('recording from an appointment', () => {
    async function pastAppointment(patientId = patientA, startsAt = '2026-03-02T09:00:00Z') {
      const r = await as(ownerA, orgA).post('/appointments', {
        patientId,
        professionalId: psychA.id,
        startsAt,
        endsAt: new Date(Date.parse(startsAt) + 50 * 60_000).toISOString(),
      });
      if (r.status !== 201) throw new Error(`appointment: ${r.status}`);
      return r.body.appointment.id as string;
    }

    it('links the session and marks the appointment completed', async () => {
      const appointmentId = await pastAppointment();
      const r = await as(psychA, orgA).post('/clinical-sessions', {
        patientId: patientA,
        professionalId: psychA.id,
        appointmentId,
        startedAt: '2026-03-02T09:00:00Z',
        durationMinutes: 50,
      });
      expect(r.status).toBe(201);
      expect(r.body.session.appointmentId).toBe(appointmentId);
      expect((await adminDb.appointment.findUniqueOrThrow({ where: { id: appointmentId } })).status).toBe('completed');
      const found = await as(staffA, orgA).get(`/clinical-sessions?appointmentId=${appointmentId}`);
      expect(found.body.sessions.map((s: { id: string }) => s.id)).toEqual([r.body.session.id]);

      const again = await as(ownerA, orgA).post('/clinical-sessions', {
        patientId: patientA,
        professionalId: psychA.id,
        appointmentId,
        startedAt: '2026-03-02T09:00:00Z',
        durationMinutes: 50,
      });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe('SESSION_ALREADY_RECORDED');
    });

    it('refuses another patient’s, a cancelled, or a future appointment', async () => {
      const others = await pastAppointment(otherPatientA, '2026-03-03T09:00:00Z');
      const cancelled = await pastAppointment(patientA, '2026-03-04T09:00:00Z');
      await as(ownerA, orgA).post(`/appointments/${cancelled}/cancel`);
      const future = await pastAppointment(patientA, '2999-03-05T09:00:00Z');
      for (const [appointmentId, code] of [
        [others, 'INVALID_APPOINTMENT'],
        [cancelled, 'APPOINTMENT_CANCELLED'],
        [future, 'NOT_YET_HAPPENED'],
      ]) {
        const r = await as(psychA, orgA).post('/clinical-sessions', {
          patientId: patientA,
          professionalId: psychA.id,
          appointmentId,
          startedAt: PAST,
          durationMinutes: 50,
        });
        expect(r.status).toBe(422);
        expect(r.body.error.code).toBe(code);
      }
    });
  });

  it('an outsider gets 404 for everything', async () => {
    const id = await recordSession(psychA);
    expect((await as(ownerB, orgB).get(`/clinical-sessions/${id}`)).status).toBe(404);
    expect((await as(ownerB, orgB).patch(`/clinical-sessions/${id}`, { durationMinutes: 1 })).status).toBe(404);
    expect((await as(ownerB, orgB).get(`/clinical-sessions?patientId=${patientA}`)).body.sessions).toEqual([]);
    expect((await as(ownerB, orgA).get(`/clinical-sessions/${id}`)).status).toBe(404);
  });
});

describe('clinical notes (F-009) and audit (F-012) — full stack', () => {
  let sessionId: string;
  let noteId: string;

  beforeAll(async () => {
    sessionId = await recordSession(psychA, { startedAt: '2026-04-06T09:00:00Z' });
  });

  it('the author opens a note (version 1); it is audited without its content', async () => {
    const r = await as(psychA, orgA).post(`/clinical-sessions/${sessionId}/notes`, { content: NOTE_V1 });
    expect(r.status).toBe(201);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.note).toMatchObject({ version: 1, content: NOTE_V1, author: { userId: psychA.id } });
    noteId = r.body.note.id;

    const audit = await auditFor(noteId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      organizationId: orgA,
      actorUserId: psychA.id,
      action: 'clinical_note.create',
      resourceType: 'clinical_note',
      metadata: { version: 1 },
    });
    expect(JSON.stringify(audit)).not.toContain('sleep');
  });

  it('one note per author per session', async () => {
    const again = await as(psychA, orgA).post(`/clinical-sessions/${sessionId}/notes`, { content: 'second' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('NOTE_EXISTS');
  });

  it('any clinician reads it, and every read is audited per note', async () => {
    const before = (await auditFor(noteId)).length;
    for (const reader of [psychA2, ownerA]) {
      const r = await as(reader, orgA).get(`/clinical-sessions/${sessionId}/notes`);
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toBe('no-store');
      expect(r.body.notes.map((n: { content: string }) => n.content)).toEqual([NOTE_V1]);
    }
    const reads = (await auditFor(noteId)).slice(before);
    expect(reads.map((a) => [a.action, a.actorUserId])).toEqual([
      ['clinical_note.read', psychA2.id],
      ['clinical_note.read', ownerA.id],
    ]);
  });

  it('a psychologist who is not the author cannot add a version (403), and nothing is written', async () => {
    const before = await auditFor(noteId);
    const r = await as(psychA2, orgA).post(`/clinical-notes/${noteId}/versions`, { content: 'hijack', baseVersion: 1 });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('NOT_NOTE_AUTHOR');
    expect(await adminDb.clinicalNoteVersion.count({ where: { clinicalNoteId: noteId } })).toBe(1);
    expect(await auditFor(noteId)).toHaveLength(before.length);
    // Not even the owner of the practice.
    expect((await as(ownerA, orgA).post(`/clinical-notes/${noteId}/versions`, { content: 'x', baseVersion: 1 })).status).toBe(403);
  });

  it('the author adds version 2 -- version 1 is kept untouched', async () => {
    const r = await as(psychA, orgA).post(`/clinical-notes/${noteId}/versions`, { content: NOTE_V2, baseVersion: 1 });
    expect(r.status).toBe(201);
    expect(r.body.note).toMatchObject({ version: 2, content: NOTE_V2 });
    const rows = await adminDb.clinicalNoteVersion.findMany({ where: { clinicalNoteId: noteId }, orderBy: { version: 'asc' } });
    expect(rows.map((v) => [v.version, v.content])).toEqual([
      [1, NOTE_V1],
      [2, NOTE_V2],
    ]);
    expect((await auditFor(noteId)).at(-1)).toMatchObject({ action: 'clinical_note.revise', metadata: { version: 2 } });
  });

  it('a save based on an old version is a conflict, not an overwrite', async () => {
    const r = await as(psychA, orgA).post(`/clinical-notes/${noteId}/versions`, { content: 'from a stale tab', baseVersion: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NOTE_STALE');
    expect(await adminDb.clinicalNoteVersion.count({ where: { clinicalNoteId: noteId } })).toBe(2);
  });

  it('the history shows every version and its read is audited', async () => {
    const r = await as(psychA2, orgA).get(`/clinical-notes/${noteId}/versions`);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(r.body.versions.map((v: { version: number; content: string }) => [v.version, v.content])).toEqual([
      [1, NOTE_V1],
      [2, NOTE_V2],
    ]);
    expect((await auditFor(noteId)).at(-1)).toMatchObject({
      action: 'clinical_note.history_read',
      actorUserId: psychA2.id,
      metadata: { versions: 2 },
    });
  });

  it('admin_staff is refused every note endpoint (403) and leaves no audit trace', async () => {
    const before = (await auditFor(noteId)).length;
    expect((await as(staffA, orgA).get(`/clinical-sessions/${sessionId}/notes`)).status).toBe(403);
    expect((await as(staffA, orgA).post(`/clinical-sessions/${sessionId}/notes`, { content: 'x' })).status).toBe(403);
    expect((await as(staffA, orgA).post(`/clinical-notes/${noteId}/versions`, { content: 'x', baseVersion: 2 })).status).toBe(403);
    expect((await as(staffA, orgA).get(`/clinical-notes/${noteId}/versions`)).status).toBe(403);
    expect(await auditFor(noteId)).toHaveLength(before);
  });

  it('an outsider gets 404, under either organization', async () => {
    for (const org of [orgB, orgA]) {
      expect((await as(ownerB, org).get(`/clinical-sessions/${sessionId}/notes`)).status).toBe(404);
      expect((await as(ownerB, org).get(`/clinical-notes/${noteId}/versions`)).status).toBe(404);
      expect((await as(ownerB, org).post(`/clinical-notes/${noteId}/versions`, { content: 'x', baseVersion: 2 })).status).toBe(404);
    }
  });

  it.each([
    ['blank content', { content: '   ' }],
    ['content over 50,000 characters', { content: 'x'.repeat(50_001) }],
    ['an unknown key', { content: 'ok', authorId: 'someone' }],
  ])('rejects %s with 400', async (_label, body) => {
    const fresh = await recordSession(psychA2);
    expect((await as(psychA2, orgA).post(`/clinical-sessions/${fresh}/notes`, body)).status).toBe(400);
  });

  it('an archived patient’s record is frozen: no new notes or versions', async () => {
    const patient = await createPatient(ownerA, orgA, 'Clinical Archived Later');
    const session = await recordSession(psychA, { patientId: patient });
    const note = (await as(psychA, orgA).post(`/clinical-sessions/${session}/notes`, { content: NOTE_V1 })).body.note.id;
    await as(ownerA, orgA).post(`/patients/${patient}/archive`);
    expect((await as(psychA, orgA).post(`/clinical-notes/${note}/versions`, { content: NOTE_V2, baseVersion: 1 })).status).toBe(422);
    expect((await as(psychA2, orgA).post(`/clinical-sessions/${session}/notes`, { content: NOTE_V1 })).status).toBe(422);
    // Still readable.
    expect((await as(psychA2, orgA).get(`/clinical-sessions/${session}/notes`)).status).toBe(200);
  });
});

describe('clinical data — RLS only (app layer removed)', () => {
  let sessionId: string;
  let noteId: string;
  const asA = (user: TestUser) => ({ userId: user.id, organizationId: orgA });

  beforeAll(async () => {
    sessionId = await recordSession(psychA, { startedAt: '2026-05-04T09:00:00Z' });
    noteId = (await as(psychA, orgA).post(`/clinical-sessions/${sessionId}/notes`, { content: NOTE_V1 })).body.note.id;
  });

  it('admin_staff sees no clinical note or version at all (the tables look empty)', async () => {
    const [notes, versions] = await asIdentity(asA(staffA), (tx) =>
      Promise.all([tx.clinicalNote.count(), tx.clinicalNoteVersion.count()]),
    );
    expect([notes, versions]).toEqual([0, 0]);
    // ...while a clinician in the same organization does, so the zero is meaningful.
    const [clinicianNotes] = await asIdentity(asA(psychA2), (tx) => Promise.all([tx.clinicalNote.count()]));
    expect(clinicianNotes).toBeGreaterThan(0);
    // ...and still sees session metadata (billing).
    expect(await asIdentity(asA(staffA), (tx) => tx.clinicalSession.count())).toBeGreaterThan(0);
  });

  it('admin_staff cannot write notes, versions or sessions, even bypassing the API', async () => {
    await expect(
      asIdentity(asA(staffA), (tx) =>
        tx.clinicalNote.create({ data: { organizationId: orgA, clinicalSessionId: sessionId, authorId: staffA.id } }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
    await expect(
      asIdentity(asA(staffA), (tx) =>
        tx.clinicalNoteVersion.createMany({
          data: [{ organizationId: orgA, clinicalNoteId: noteId, version: 2, content: 'x', createdBy: staffA.id }],
        }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
    await expect(
      asIdentity(asA(staffA), (tx) =>
        tx.clinicalSession.create({
          data: { organizationId: orgA, patientId: patientA, professionalId: psychA.id, startedAt: new Date(PAST), durationMinutes: 50, createdBy: staffA.id },
        }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
    const { count } = await asIdentity(asA(staffA), (tx) =>
      tx.clinicalSession.updateMany({ where: { id: sessionId }, data: { durationMinutes: 1 } }),
    );
    expect(count).toBe(0);
  });

  it('a psychologist who is not the author cannot add a version, even bypassing the API', async () => {
    for (const createdBy of [psychA2.id, psychA.id]) {
      // Neither as themselves nor pretending to be the author.
      await expect(
        asIdentity(asA(psychA2), (tx) =>
          tx.clinicalNoteVersion.createMany({
            data: [{ organizationId: orgA, clinicalNoteId: noteId, version: 2, content: 'hijack', createdBy }],
          }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
    }
    // The author can (the policy is not simply closed).
    await asIdentity(asA(psychA), (tx) =>
      tx.clinicalNoteVersion.createMany({
        data: [{ organizationId: orgA, clinicalNoteId: noteId, version: 2, content: NOTE_V2, createdBy: psychA.id }],
      }),
    );
    expect(await adminDb.clinicalNoteVersion.count({ where: { clinicalNoteId: noteId } })).toBe(2);
  });

  it('versions and notes are immutable for everyone, the author included', async () => {
    await expect(
      asIdentity(asA(psychA), (tx) => tx.clinicalNoteVersion.updateMany({ where: { clinicalNoteId: noteId }, data: { content: 'rewritten' } })),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      asIdentity(asA(psychA), (tx) => tx.clinicalNoteVersion.deleteMany({ where: { clinicalNoteId: noteId } })),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      asIdentity(asA(psychA), (tx) => tx.clinicalNote.updateMany({ where: { id: noteId }, data: { authorId: psychA2.id } })),
    ).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      asIdentity(asA(ownerA), (tx) => tx.clinicalSession.deleteMany({ where: { id: sessionId } })),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it('the audit log is write-only and only for your own actions', async () => {
    await expect(asIdentity(asA(ownerA), (tx) => tx.auditLog.count())).rejects.toThrow(PERMISSION_DENIED);
    await expect(
      asIdentity(asA(ownerA), (tx) =>
        tx.auditLog.createMany({
          data: [{ organizationId: orgA, actorUserId: psychA.id, action: 'clinical_note.read', resourceType: 'clinical_note', resourceId: noteId }],
        }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
    await expect(
      asIdentity(asA(ownerA), (tx) => tx.auditLog.deleteMany({ where: { resourceId: noteId } })),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it('an outsider sees no sessions, notes or versions of A', async () => {
    for (const organizationId of [orgA, orgB]) {
      const counts = await asIdentity({ userId: ownerB.id, organizationId }, (tx) =>
        Promise.all([
          tx.clinicalSession.count({ where: { organizationId: orgA } }),
          tx.clinicalNote.count({ where: { organizationId: orgA } }),
          tx.clinicalNoteVersion.count({ where: { organizationId: orgA } }),
        ]),
      );
      expect(counts).toEqual([0, 0, 0]);
    }
  });
});

describe('clinical data — integrity, bypassing the app layer entirely', () => {
  it('refuses blank content, version 0, absurd durations and free-text audit actions', async () => {
    const session = await adminDb.clinicalSession.create({
      data: { organizationId: orgA, patientId: patientA, professionalId: psychA.id, startedAt: new Date(PAST), durationMinutes: 50, createdBy: psychA.id },
    });
    const note = await adminDb.clinicalNote.create({
      data: { organizationId: orgA, clinicalSessionId: session.id, authorId: ownerA.id },
    });
    const version = (v: number, content: string) =>
      adminDb.clinicalNoteVersion.create({ data: { organizationId: orgA, clinicalNoteId: note.id, version: v, content, createdBy: ownerA.id } });
    await expect(version(1, '  \n ')).rejects.toThrow(/clinical_note_versions_content_valid/);
    await expect(version(0, 'x')).rejects.toThrow(/clinical_note_versions_version_positive/);
    await version(1, 'x');
    await expect(version(1, 'y')).rejects.toThrow(/Unique constraint/);
    await expect(
      adminDb.clinicalSession.update({ where: { id: session.id }, data: { durationMinutes: 721 } }),
    ).rejects.toThrow(/clinical_sessions_duration_valid/);
    await expect(
      adminDb.auditLog.create({
        data: { organizationId: orgA, actorUserId: ownerA.id, action: 'read note: patient said...', resourceType: 'clinical_note', resourceId: note.id },
      }),
    ).rejects.toThrow(/audit_logs_vocabulary/);
  });

  it('a session can only link an appointment of the same patient and organization (composite FK)', async () => {
    const appointment = await adminDb.appointment.create({
      data: {
        organizationId: orgA,
        patientId: otherPatientA,
        professionalId: psychA.id,
        scheduledStart: new Date('2026-06-01T09:00:00Z'),
        scheduledEnd: new Date('2026-06-01T10:00:00Z'),
        createdBy: ownerA.id,
      },
    });
    await expect(
      adminDb.clinicalSession.create({
        data: { organizationId: orgA, patientId: patientA, professionalId: psychA.id, appointmentId: appointment.id, startedAt: new Date(PAST), durationMinutes: 50, createdBy: psychA.id },
      }),
    ).rejects.toThrow(/Foreign key constraint/);
    await expect(
      adminDb.clinicalSession.create({
        data: { organizationId: orgA, patientId: patientB, professionalId: psychA.id, startedAt: new Date(PAST), durationMinutes: 50, createdBy: psychA.id },
      }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});
