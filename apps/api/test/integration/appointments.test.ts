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
 * Milestone 3 (F-006, F-007, ADR-0015). Definition of done: no double-booking
 * is possible even via a direct database insert -- proven below by inserting
 * with the privileged client, which bypasses the API and RLS entirely.
 *
 *   Org A: ownerA (owner), psychA (psychologist), staffA (admin_staff),
 *          multi (psychologist)
 *   Org B: ownerB (owner), multi (owner of their own practice, not B) -- see
 *          the cross-organization test
 *
 * All data synthetic. Times are fixed, far in the future (or past, for
 * outcomes) so the suite is independent of when it runs.
 */

const app = createApp();
const RLS_VIOLATION = /row-level security/;
const PERMISSION_DENIED = /permission denied/;

type Member = TestUser & { organizationId: string };
let ownerA: Member;
let ownerB: Member;
let multi: Member;
let psychA: TestUser;
let staffA: TestUser;
let orgA: string;
let orgB: string;
let patientA1: string;
let patientA2: string;
let patientB1: string;
let archivedPatientA: string;
let patientMulti: string;

/** 2030-01-07 is a Monday; `at(day, "10:30")` -> that day of that week, UTC. */
const at = (day: number, time: string) => `2030-01-${String(7 + day).padStart(2, '0')}T${time}:00.000Z`;

const as = (user: TestUser, organizationId: string) => {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${user.token}`).set('X-Organization-Id', organizationId);
  return {
    get: (path: string) => auth(request(app).get(path)),
    post: (path: string, body: object = {}) => auth(request(app).post(path)).send(body),
    patch: (path: string, body: object) => auth(request(app).patch(path)).send(body),
  };
};

async function createPatient(user: TestUser, organizationId: string, fullName: string): Promise<string> {
  const response = await as(user, organizationId).post('/patients', { fullName });
  if (response.status !== 201) throw new Error(`patient: ${response.status}`);
  return response.body.patient.id;
}

async function book(
  user: TestUser,
  organizationId: string,
  body: { patientId: string; professionalId: string; startsAt: string; endsAt: string; [k: string]: unknown },
) {
  return as(user, organizationId).post('/appointments', body);
}

async function bookOk(...args: Parameters<typeof book>): Promise<string> {
  const response = await book(...args);
  if (response.status !== 201) throw new Error(`book: ${response.status} ${JSON.stringify(response.body)}`);
  return response.body.appointment.id;
}

beforeAll(async () => {
  await resetDatabase();
  ownerA = await bootstrapUser(app, 'owner-a');
  ownerB = await bootstrapUser(app, 'owner-b');
  multi = await bootstrapUser(app, 'multi');
  orgA = ownerA.organizationId;
  orgB = ownerB.organizationId;
  psychA = await makeUser('psych-a');
  staffA = await makeUser('staff-a');
  await inviteMember(app, ownerA, 'psychologist', psychA);
  await inviteMember(app, ownerA, 'admin_staff', staffA);
  await inviteMember(app, ownerA, 'psychologist', multi);

  patientA1 = await createPatient(ownerA, orgA, 'Appt Patient A1');
  patientA2 = await createPatient(ownerA, orgA, 'Appt Patient A2');
  patientB1 = await createPatient(ownerB, orgB, 'Appt Patient B1');
  patientMulti = await createPatient(multi, multi.organizationId, 'Appt Patient Multi');
  archivedPatientA = await createPatient(ownerA, orgA, 'Appt Archived Patient');
  await as(ownerA, orgA).post(`/patients/${archivedPatientA}/archive`);
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), runtimeDb.$disconnect()]);
});

describe('appointments — full stack: role matrix and lifecycle', () => {
  it.each([
    ['owner', () => ownerA, 0],
    ['psychologist', () => psychA, 1],
    ['admin_staff', () => staffA, 2],
  ])('%s can book, read, reschedule and cancel', async (_role, who, day) => {
    const user = who();
    const created = await book(user, orgA, {
      patientId: patientA1,
      professionalId: psychA.id,
      startsAt: at(day, '09:00'),
      endsAt: at(day, '10:00'),
      modality: 'online',
    });
    expect(created.status).toBe(201);
    expect(created.body.appointment).toMatchObject({
      patient: { id: patientA1, fullName: 'Appt Patient A1' },
      professional: { userId: psychA.id, fullName: 'Synthetic psych-a' },
      startsAt: at(day, '09:00'),
      endsAt: at(day, '10:00'),
      status: 'scheduled',
      modality: 'online',
      cancelledAt: null,
    });
    const id = created.body.appointment.id;

    expect((await as(user, orgA).get(`/appointments/${id}`)).status).toBe(200);

    // F-006: rescheduling moves the SAME appointment, not cancel + recreate.
    const moved = await as(user, orgA).patch(`/appointments/${id}`, {
      startsAt: at(day, '11:00'),
      endsAt: at(day, '12:00'),
      status: 'confirmed',
    });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment).toMatchObject({ id, startsAt: at(day, '11:00'), status: 'confirmed' });

    const cancelled = await as(user, orgA).post(`/appointments/${id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.appointment.status).toBe('cancelled');
    expect(cancelled.body.appointment.cancelledAt).not.toBeNull();

    const row = await adminDb.appointment.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ createdBy: user.id, organizationId: orgA });
  });

  it('a cancelled appointment is final', async () => {
    const id = await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: ownerA.id,
      startsAt: at(3, '09:00'),
      endsAt: at(3, '10:00'),
    });
    await as(ownerA, orgA).post(`/appointments/${id}/cancel`);
    const edit = await as(ownerA, orgA).patch(`/appointments/${id}`, { modality: 'online' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('APPOINTMENT_CANCELLED');
    expect((await as(ownerA, orgA).post(`/appointments/${id}/cancel`)).status).toBe(409);
  });

  it('there is no DELETE endpoint', async () => {
    const id = await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: ownerA.id,
      startsAt: at(3, '12:00'),
      endsAt: at(3, '13:00'),
    });
    const response = await request(app)
      .delete(`/appointments/${id}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .set('X-Organization-Id', orgA);
    expect(response.status).toBe(404);
    expect(await adminDb.appointment.count({ where: { id } })).toBe(1);
  });

  it('an outcome can be recorded only once the appointment has started', async () => {
    const future = await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: ownerA.id,
      startsAt: at(3, '15:00'),
      endsAt: at(3, '16:00'),
    });
    for (const status of ['completed', 'no_show']) {
      const response = await as(ownerA, orgA).patch(`/appointments/${future}`, { status });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('NOT_YET_HAPPENED');
    }

    const past = await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: ownerA.id,
      startsAt: '2020-03-02T09:00:00.000Z',
      endsAt: '2020-03-02T10:00:00.000Z',
    });
    const done = await as(staffA, orgA).patch(`/appointments/${past}`, { status: 'completed' });
    expect(done.status).toBe(200);
    expect(done.body.appointment.status).toBe('completed');
  });
});

describe('appointments — full stack: who and what can be booked', () => {
  it.each([
    ['an admin_staff member', () => staffA.id],
    ['a member of another organization', () => ownerB.id],
    ['an unknown user', () => '00000000-0000-4000-8000-000000000000'],
  ])('refuses %s as the professional with 422', async (_label, professionalId) => {
    const response = await book(ownerA, orgA, {
      patientId: patientA1,
      professionalId: professionalId(),
      startsAt: at(4, '09:00'),
      endsAt: at(4, '10:00'),
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('INVALID_PROFESSIONAL');
  });

  it('refuses another organization’s patient exactly like an unknown one', async () => {
    for (const patientId of [patientB1, '00000000-0000-4000-8000-000000000000']) {
      const response = await book(ownerA, orgA, {
        patientId,
        professionalId: ownerA.id,
        startsAt: at(4, '09:00'),
        endsAt: at(4, '10:00'),
      });
      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('INVALID_PATIENT');
    }
  });

  it('refuses an archived patient', async () => {
    const response = await book(ownerA, orgA, {
      patientId: archivedPatientA,
      professionalId: ownerA.id,
      startsAt: at(4, '09:00'),
      endsAt: at(4, '10:00'),
    });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('PATIENT_ARCHIVED');
  });

  it('refuses reassigning to someone who cannot be the professional', async () => {
    const id = await bookOk(ownerA, orgA, {
      patientId: patientA1,
      professionalId: ownerA.id,
      startsAt: at(4, '11:00'),
      endsAt: at(4, '12:00'),
    });
    const response = await as(ownerA, orgA).patch(`/appointments/${id}`, { professionalId: staffA.id });
    expect(response.status).toBe(422);
    const ok = await as(ownerA, orgA).patch(`/appointments/${id}`, { professionalId: psychA.id });
    expect(ok.status).toBe(200);
    expect(ok.body.appointment.professional.userId).toBe(psychA.id);
  });
});

describe('appointments — full stack: conflict prevention (F-007)', () => {
  const day = 5;

  it('refuses an overlapping appointment for the same professional', async () => {
    await bookOk(ownerA, orgA, {
      patientId: patientA1,
      professionalId: psychA.id,
      startsAt: at(day, '09:00'),
      endsAt: at(day, '10:00'),
    });
    const response = await book(staffA, orgA, {
      patientId: patientA2,
      professionalId: psychA.id,
      startsAt: at(day, '09:30'),
      endsAt: at(day, '10:30'),
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROFESSIONAL_CONFLICT');
  });

  it('refuses an overlapping appointment for the same patient with another professional', async () => {
    const response = await book(staffA, orgA, {
      patientId: patientA1,
      professionalId: ownerA.id,
      startsAt: at(day, '09:15'),
      endsAt: at(day, '09:45'),
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PATIENT_CONFLICT');
  });

  it('allows back-to-back appointments (half-open ranges)', async () => {
    const response = await book(staffA, orgA, {
      patientId: patientA1,
      professionalId: psychA.id,
      startsAt: at(day, '10:00'),
      endsAt: at(day, '11:00'),
    });
    expect(response.status).toBe(201);
  });

  it('a cancelled appointment frees its slot', async () => {
    const id = await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: ownerA.id,
      startsAt: at(day, '14:00'),
      endsAt: at(day, '15:00'),
    });
    expect(
      (await book(ownerA, orgA, { patientId: patientA2, professionalId: ownerA.id, startsAt: at(day, '14:00'), endsAt: at(day, '15:00') }))
        .status,
    ).toBe(409);
    await as(ownerA, orgA).post(`/appointments/${id}/cancel`);
    expect(
      (await book(ownerA, orgA, { patientId: patientA2, professionalId: ownerA.id, startsAt: at(day, '14:00'), endsAt: at(day, '15:00') }))
        .status,
    ).toBe(201);
  });

  it('rescheduling into an occupied slot is refused and changes nothing', async () => {
    const id = await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: psychA.id,
      startsAt: at(day, '16:00'),
      endsAt: at(day, '17:00'),
    });
    const response = await as(ownerA, orgA).patch(`/appointments/${id}`, {
      startsAt: at(day, '09:30'),
      endsAt: at(day, '10:30'),
    });
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('PROFESSIONAL_CONFLICT');
    const row = await adminDb.appointment.findUniqueOrThrow({ where: { id } });
    expect(row.scheduledStart.toISOString()).toBe(at(day, '16:00'));
  });

  it('the same professional in two organizations is checked per organization (ADR-0015)', async () => {
    await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: multi.id,
      startsAt: at(6, '09:00'),
      endsAt: at(6, '10:00'),
    });
    const ownPractice = await book(multi, multi.organizationId, {
      patientId: patientMulti,
      professionalId: multi.id,
      startsAt: at(6, '09:00'),
      endsAt: at(6, '10:00'),
    });
    expect(ownPractice.status).toBe(201);
  });
});

describe('appointments — full stack: validation', () => {
  const valid = () => ({
    patientId: patientA1,
    professionalId: ownerA.id,
    startsAt: at(8, '09:00'),
    endsAt: at(8, '10:00'),
  });

  it.each([
    ['organizationId in the body', () => ({ ...valid(), organizationId: orgB })],
    ['createdBy in the body', () => ({ ...valid(), createdBy: staffA.id })],
    ['status cancelled', () => ({ ...valid(), status: 'cancelled' })],
    ['status completed', () => ({ ...valid(), status: 'completed' })],
    ['a time without an offset', () => ({ ...valid(), startsAt: '2030-01-15T09:00:00' })],
    ['an unknown modality', () => ({ ...valid(), modality: 'phone' })],
    ['a missing patient', () => ({ ...valid(), patientId: undefined })],
  ])('rejects %s on create with 400', async (_label, body) => {
    expect((await as(ownerA, orgA).post('/appointments', body())).status).toBe(400);
  });

  it.each([
    ['an end before the start', at(8, '10:00'), at(8, '09:00')],
    ['a zero-length appointment', at(8, '10:00'), at(8, '10:00')],
    ['more than 12 hours', at(8, '06:00'), at(8, '18:01')],
  ])('rejects %s with 400 INVALID_TIME_RANGE', async (_label, startsAt, endsAt) => {
    const response = await as(ownerA, orgA).post('/appointments', { ...valid(), startsAt, endsAt });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_TIME_RANGE');
  });

  it('judges a partial reschedule against the rest of the row', async () => {
    const id = await bookOk(ownerA, orgA, valid());
    const response = await as(ownerA, orgA).patch(`/appointments/${id}`, { endsAt: at(8, '08:00') });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_TIME_RANGE');
  });

  it('rejects patientId, organizationId, status cancelled and empty bodies on PATCH', async () => {
    const id = await bookOk(ownerA, orgA, { ...valid(), startsAt: at(8, '11:00'), endsAt: at(8, '12:00') });
    for (const body of [{ patientId: patientA2 }, { organizationId: orgB }, { status: 'cancelled' }, {}]) {
      expect((await as(ownerA, orgA).patch(`/appointments/${id}`, body)).status).toBe(400);
    }
  });

  it.each([
    ['no window', ''],
    ['to before from', `from=${at(1, '00:00')}&to=${at(0, '00:00')}`],
    ['a window over 62 days', 'from=2030-01-01T00:00:00Z&to=2030-03-05T00:00:00Z'],
    ['an unknown parameter', `from=${at(0, '00:00')}&to=${at(1, '00:00')}&x=1`],
  ])('rejects a list with %s', async (_label, query) => {
    expect((await as(ownerA, orgA).get(`/appointments?${query}`)).status).toBe(400);
  });
});

describe('appointments — full stack: the calendar window', () => {
  let window: Member;
  let professional: string;
  let patient: string;

  beforeAll(async () => {
    window = await bootstrapUser(app, 'calendar-owner');
    professional = window.id;
    patient = await createPatient(window, window.organizationId, 'Calendar Patient');
    const slots: [string, string][] = [
      ['2030-02-04T09:00:00Z', '2030-02-04T10:00:00Z'],
      ['2030-02-04T23:30:00Z', '2030-02-05T00:30:00Z'], // crosses midnight
      ['2030-02-05T12:00:00Z', '2030-02-05T13:00:00Z'],
      ['2030-02-06T12:00:00Z', '2030-02-06T13:00:00Z'],
    ];
    for (const [startsAt, endsAt] of slots) {
      await bookOk(window, window.organizationId, { patientId: patient, professionalId: professional, startsAt, endsAt });
    }
    const cancelled = await bookOk(window, window.organizationId, {
      patientId: patient,
      professionalId: professional,
      startsAt: '2030-02-05T15:00:00Z',
      endsAt: '2030-02-05T16:00:00Z',
    });
    await as(window, window.organizationId).post(`/appointments/${cancelled}/cancel`);
  });

  const list = (query: string) => as(window, window.organizationId).get(`/appointments?${query}`);
  const starts = (body: { appointments: { startsAt: string }[] }) => body.appointments.map((a) => a.startsAt);

  it('returns what overlaps the window, by start time, without cancelled ones', async () => {
    const day = await list('from=2030-02-05T00:00:00Z&to=2030-02-06T00:00:00Z');
    expect(day.status).toBe(200);
    expect(starts(day.body)).toEqual(['2030-02-04T23:30:00.000Z', '2030-02-05T12:00:00.000Z']);
  });

  it('includes cancelled ones on request', async () => {
    const day = await list('from=2030-02-05T00:00:00Z&to=2030-02-06T00:00:00Z&includeCancelled=true');
    expect(day.body.appointments).toHaveLength(3);
    expect(day.body.appointments.at(-1).status).toBe('cancelled');
  });

  it('filters by professional and by patient', async () => {
    const week = 'from=2030-02-04T00:00:00Z&to=2030-02-11T00:00:00Z';
    expect((await list(`${week}&professionalId=${professional}`)).body.appointments).toHaveLength(4);
    expect((await list(`${week}&professionalId=${ownerA.id}`)).body.appointments).toHaveLength(0);
    expect((await list(`${week}&patientId=${patient}`)).body.appointments).toHaveLength(4);
  });
});

describe('appointments — full stack: cross-tenant isolation', () => {
  let appointmentOfA: string;

  beforeAll(async () => {
    appointmentOfA = await bookOk(ownerA, orgA, {
      patientId: patientA1,
      professionalId: ownerA.id,
      startsAt: at(9, '09:00'),
      endsAt: at(9, '10:00'),
    });
  });

  it('an outsider gets 404 for another organization’s appointment, under their own organization', async () => {
    expect((await as(ownerB, orgB).get(`/appointments/${appointmentOfA}`)).status).toBe(404);
    expect((await as(ownerB, orgB).patch(`/appointments/${appointmentOfA}`, { modality: 'online' })).status).toBe(404);
    expect((await as(ownerB, orgB).post(`/appointments/${appointmentOfA}/cancel`)).status).toBe(404);
    const list = await as(ownerB, orgB).get(`/appointments?from=${at(9, '00:00')}&to=${at(10, '00:00')}`);
    expect(list.body.appointments).toEqual([]);
  });

  it('an outsider naming the other organization gets 404 for everything, members included', async () => {
    expect((await as(ownerB, orgA).get(`/appointments?from=${at(9, '00:00')}&to=${at(10, '00:00')}`)).status).toBe(404);
    expect((await as(ownerB, orgA).get(`/appointments/${appointmentOfA}`)).status).toBe(404);
    expect((await as(ownerB, orgA).get('/organizations/current/members')).status).toBe(404);
  });

  it('nothing changed in organization A', async () => {
    const row = await adminDb.appointment.findUniqueOrThrow({ where: { id: appointmentOfA } });
    expect(row).toMatchObject({ status: 'scheduled', modality: 'in_person' });
  });
});

describe('organization members (for the professional picker)', () => {
  it('lists the active members with name and role, and no email', async () => {
    const response = await as(staffA, orgA).get('/organizations/current/members');
    expect(response.status).toBe(200);
    const byId = Object.fromEntries(
      response.body.members.map((m: { userId: string; role: string }) => [m.userId, m.role]),
    );
    expect(byId).toEqual({
      [ownerA.id]: 'owner',
      [psychA.id]: 'psychologist',
      [staffA.id]: 'admin_staff',
      [multi.id]: 'psychologist',
    });
    expect(JSON.stringify(response.body)).not.toContain('@');
  });

  it('a suspended professional disappears from the picker but their appointments still load', async () => {
    const id = await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: psychA.id,
      startsAt: at(10, '09:00'),
      endsAt: at(10, '10:00'),
    });
    const key = { organizationId_userId: { organizationId: orgA, userId: psychA.id } };
    await adminDb.membership.update({ where: key, data: { status: 'suspended' } });
    try {
      const members = await as(ownerA, orgA).get('/organizations/current/members');
      expect(members.body.members.map((m: { userId: string }) => m.userId)).not.toContain(psychA.id);

      const appointment = await as(ownerA, orgA).get(`/appointments/${id}`);
      expect(appointment.status).toBe(200);
      expect(appointment.body.appointment.professional).toEqual({ userId: psychA.id, fullName: null });

      // ...and can still be cancelled (the RLS update policy allows it).
      expect((await as(ownerA, orgA).post(`/appointments/${id}/cancel`)).status).toBe(200);
    } finally {
      await adminDb.membership.update({ where: key, data: { status: 'active' } });
    }
  });
});

describe('appointments — RLS only (app layer removed)', () => {
  let appointmentOfA: string;
  const asA = (user: TestUser) => ({ userId: user.id, organizationId: orgA });
  const row = (user: TestUser, overrides: Record<string, unknown> = {}) => ({
    organizationId: orgA,
    createdBy: user.id,
    patientId: patientA1,
    professionalId: ownerA.id,
    scheduledStart: new Date(at(12, '09:00')),
    scheduledEnd: new Date(at(12, '10:00')),
    ...overrides,
  });

  beforeAll(async () => {
    appointmentOfA = await bookOk(ownerA, orgA, {
      patientId: patientA2,
      professionalId: psychA.id,
      startsAt: at(11, '09:00'),
      endsAt: at(11, '10:00'),
    });
  });

  it('an outsider sees none of A’s appointments, whichever organization they declare', async () => {
    for (const organizationId of [orgA, orgB]) {
      const rows = await asIdentity({ userId: ownerB.id, organizationId }, (tx) =>
        tx.appointment.findMany({ where: { organizationId: orgA } }),
      );
      expect(rows).toEqual([]);
    }
  });

  it('an outsider cannot book into A or update A’s appointments', async () => {
    await expect(
      asIdentity({ userId: ownerB.id, organizationId: orgA }, (tx) => tx.appointment.create({ data: row(ownerB) })),
    ).rejects.toThrow();
    const { count } = await asIdentity({ userId: ownerB.id, organizationId: orgA }, (tx) =>
      tx.appointment.updateMany({ where: { id: appointmentOfA }, data: { modality: 'online' } }),
    );
    expect(count).toBe(0);
  });

  it('admin_staff cannot be booked as the professional, even bypassing the API', async () => {
    await expect(
      asIdentity(asA(ownerA), (tx) => tx.appointment.create({ data: row(ownerA, { professionalId: staffA.id }) })),
    ).rejects.toThrow(RLS_VIOLATION);
    await expect(
      asIdentity(asA(ownerA), (tx) =>
        tx.appointment.updateMany({ where: { id: appointmentOfA }, data: { professionalId: staffA.id } }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('an archived patient cannot be booked, even bypassing the API', async () => {
    await expect(
      asIdentity(asA(ownerA), (tx) => tx.appointment.create({ data: row(ownerA, { patientId: archivedPatientA }) })),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('nobody books as someone else, or a pre-cancelled appointment', async () => {
    await expect(
      asIdentity(asA(staffA), (tx) => tx.appointment.create({ data: row(ownerA) })),
    ).rejects.toThrow(RLS_VIOLATION);
    await expect(
      asIdentity(asA(ownerA), (tx) =>
        tx.appointment.create({ data: row(ownerA, { status: 'cancelled', cancelledAt: new Date() }) }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('a cancelled appointment is invisible to UPDATE (final)', async () => {
    const id = await bookOk(ownerA, orgA, {
      patientId: patientA1,
      professionalId: ownerA.id,
      startsAt: at(11, '12:00'),
      endsAt: at(11, '13:00'),
    });
    await as(ownerA, orgA).post(`/appointments/${id}/cancel`);
    const { count } = await asIdentity(asA(ownerA), (tx) =>
      tx.appointment.updateMany({ where: { id }, data: { status: 'scheduled', cancelledAt: null } }),
    );
    expect(count).toBe(0);
  });

  it('nobody can delete an appointment: no DELETE grant', async () => {
    await expect(
      asIdentity(asA(ownerA), (tx) => tx.appointment.deleteMany({ where: { id: appointmentOfA } })),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it.each([
    ['patientId', () => ({ patientId: patientA1 })],
    ['organizationId', () => ({ organizationId: orgB })],
    ['createdBy', () => ({ createdBy: staffA.id })],
  ])('nobody can rewrite %s: no column grant', async (_column, data) => {
    await expect(
      asIdentity(asA(ownerA), (tx) => tx.appointment.updateMany({ where: { id: appointmentOfA }, data: data() })),
    ).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe('appointments — F-007 definition of done: the database itself refuses double-booking', () => {
  // adminDb is the privileged client: no API, no RLS, no application checks
  // of any kind stand in front of these inserts. Only the constraints do.
  const base = (overrides: Record<string, unknown> = {}) => ({
    organizationId: orgA,
    createdBy: ownerA.id,
    patientId: patientA1,
    professionalId: psychA.id,
    scheduledStart: new Date('2031-06-02T09:00:00Z'),
    scheduledEnd: new Date('2031-06-02T10:00:00Z'),
    ...overrides,
  });

  beforeAll(async () => {
    await adminDb.appointment.create({ data: base() });
  });

  it('rejects an overlapping appointment for the same professional', async () => {
    await expect(
      adminDb.appointment.create({
        data: base({ patientId: patientA2, scheduledStart: new Date('2031-06-02T09:59:00Z'), scheduledEnd: new Date('2031-06-02T11:00:00Z') }),
      }),
    ).rejects.toThrow(/no_professional_overlap/);
  });

  it('rejects an overlapping appointment for the same patient', async () => {
    await expect(
      adminDb.appointment.create({ data: base({ professionalId: ownerA.id }) }),
    ).rejects.toThrow(/no_patient_overlap/);
  });

  it('rejects moving an existing appointment onto an occupied slot', async () => {
    const other = await adminDb.appointment.create({
      data: base({ patientId: patientA2, scheduledStart: new Date('2031-06-02T12:00:00Z'), scheduledEnd: new Date('2031-06-02T13:00:00Z') }),
    });
    await expect(
      adminDb.appointment.update({
        where: { id: other.id },
        data: { scheduledStart: new Date('2031-06-02T09:30:00Z'), scheduledEnd: new Date('2031-06-02T10:30:00Z') },
      }),
    ).rejects.toThrow(/no_professional_overlap/);
  });

  it('accepts back-to-back, and an overlap with a cancelled appointment', async () => {
    await adminDb.appointment.create({
      data: base({ scheduledStart: new Date('2031-06-02T10:00:00Z'), scheduledEnd: new Date('2031-06-02T11:00:00Z') }),
    });
    await adminDb.appointment.create({
      data: base({ status: 'cancelled', cancelledAt: new Date() }),
    });
  });

  it.each([
    ['an end before the start', { scheduledEnd: new Date('2031-06-03T08:00:00Z'), scheduledStart: new Date('2031-06-03T09:00:00Z') }, /appointment_time_valid/],
    ['more than 12 hours', { scheduledStart: new Date('2031-06-03T00:00:00Z'), scheduledEnd: new Date('2031-06-03T12:01:00Z') }, /appointment_time_valid/],
    ['cancelled without cancelled_at', { status: 'cancelled', scheduledStart: new Date('2031-06-04T09:00:00Z'), scheduledEnd: new Date('2031-06-04T10:00:00Z') }, /appointments_cancelled_consistent/],
  ])('rejects %s', async (_label, overrides, constraint) => {
    await expect(adminDb.appointment.create({ data: base(overrides) })).rejects.toThrow(constraint);
  });

  it.each([
    ['a patient of another organization', () => ({ patientId: patientB1 })],
    ['a professional of another organization', () => ({ professionalId: ownerB.id })],
  ])('rejects %s (composite FK, ADR-0004)', async (_label, overrides) => {
    await expect(
      adminDb.appointment.create({
        data: base({ ...overrides(), scheduledStart: new Date('2031-06-05T09:00:00Z'), scheduledEnd: new Date('2031-06-05T10:00:00Z') }),
      }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});
