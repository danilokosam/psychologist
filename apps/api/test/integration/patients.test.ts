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
 * Milestone 2 definition of done (F-005): patients are isolated per
 * organization at BOTH layers (docs/SECURITY.md), and the owner-only archive
 * rule holds even with the application layer removed (ADR-0014).
 *
 *   Org A: ownerA (owner), psychA (psychologist), staffA (admin_staff)
 *   Org B: ownerB (owner) -- the outsider
 *
 * All patient data is synthetic.
 */

const app = createApp();
const RLS_VIOLATION = /row-level security/;
const PERMISSION_DENIED = /permission denied/;

type Member = TestUser & { organizationId: string };
let ownerA: Member;
let ownerB: Member;
let psychA: TestUser;
let staffA: TestUser;
let orgA: string;
let orgB: string;

const as = (user: TestUser, organizationId: string) => ({
  get: (path: string) =>
    request(app).get(path).set('Authorization', `Bearer ${user.token}`).set('X-Organization-Id', organizationId),
  post: (path: string, body: object = {}) =>
    request(app)
      .post(path)
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Organization-Id', organizationId)
      .send(body),
  patch: (path: string, body: object) =>
    request(app)
      .patch(path)
      .set('Authorization', `Bearer ${user.token}`)
      .set('X-Organization-Id', organizationId)
      .send(body),
});

async function createPatient(user: TestUser, organizationId: string, body: object): Promise<string> {
  const response = await as(user, organizationId).post('/patients', body);
  if (response.status !== 201) {
    throw new Error(`create failed: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return response.body.patient.id;
}

beforeAll(async () => {
  await resetDatabase();
  ownerA = await bootstrapUser(app, 'owner-a');
  ownerB = await bootstrapUser(app, 'owner-b');
  orgA = ownerA.organizationId;
  orgB = ownerB.organizationId;
  psychA = await makeUser('psych-a');
  staffA = await makeUser('staff-a');
  await inviteMember(app, ownerA, 'psychologist', psychA);
  await inviteMember(app, ownerA, 'admin_staff', staffA);
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), runtimeDb.$disconnect()]);
});

describe('patients — full stack: role matrix (SECURITY.md)', () => {
  it.each([
    ['owner', () => ownerA],
    ['psychologist', () => psychA],
    ['admin_staff', () => staffA],
  ])('%s can create, read and update a patient', async (_role, who) => {
    const user = who();
    const created = await as(user, orgA).post('/patients', {
      fullName: '  Synthetic Patient  ',
      email: 'Synthetic.Patient@Example.TEST',
      dateOfBirth: '1990-05-17',
      phone: '+34 600 000 000',
    });
    expect(created.status).toBe(201);
    // Normalized on the way in, and the date survives as a calendar date.
    expect(created.body.patient).toMatchObject({
      fullName: 'Synthetic Patient',
      email: 'synthetic.patient@example.test',
      dateOfBirth: '1990-05-17',
      status: 'active',
      archivedAt: null,
    });
    const id = created.body.patient.id;

    const read = await as(user, orgA).get(`/patients/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.patient.id).toBe(id);

    const updated = await as(user, orgA).patch(`/patients/${id}`, { phone: null, status: 'inactive' });
    expect(updated.status).toBe(200);
    expect(updated.body.patient).toMatchObject({ phone: null, status: 'inactive', email: 'synthetic.patient@example.test' });
    expect(new Date(updated.body.patient.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(created.body.patient.updatedAt).getTime(),
    );

    // Recorded as created by the caller -- taken from the token, not the body.
    const row = await adminDb.patient.findUniqueOrThrow({ where: { id } });
    expect(row.createdBy).toBe(user.id);
    expect(row.organizationId).toBe(orgA);
  });

  it.each([
    ['psychologist', () => psychA],
    ['admin_staff', () => staffA],
  ])('%s is refused archive and restore with 403', async (_role, who) => {
    const id = await createPatient(ownerA, orgA, { fullName: 'Archive Target' });
    expect((await as(who(), orgA).post(`/patients/${id}/archive`)).status).toBe(403);

    await as(ownerA, orgA).post(`/patients/${id}/archive`);
    expect((await as(who(), orgA).post(`/patients/${id}/restore`)).status).toBe(403);

    const row = await adminDb.patient.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe('archived');
  });

  it('owner archives and restores; archived patients are read-only and off the working list', async () => {
    const id = await createPatient(staffA, orgA, { fullName: 'Zz Archivable Patient' });

    const archived = await as(ownerA, orgA).post(`/patients/${id}/archive`);
    expect(archived.status).toBe(200);
    expect(archived.body.patient.status).toBe('archived');
    expect(archived.body.patient.archivedAt).not.toBeNull();

    expect((await as(ownerA, orgA).post(`/patients/${id}/archive`)).status).toBe(409);

    // Still readable by every role -- the record is kept, not hidden.
    expect((await as(staffA, orgA).get(`/patients/${id}`)).status).toBe(200);

    // Read-only for everyone, owner included, until restored.
    for (const user of [ownerA, psychA, staffA]) {
      const edit = await as(user, orgA).patch(`/patients/${id}`, { fullName: 'Changed' });
      expect(edit.status).toBe(409);
      expect(edit.body.error.code).toBe('PATIENT_ARCHIVED');
    }

    const working = await as(ownerA, orgA).get('/patients?q=Archivable');
    expect(working.body.patients).toHaveLength(0);
    const archive = await as(ownerA, orgA).get('/patients?q=Archivable&status=archived');
    expect(archive.body.patients.map((p: { id: string }) => p.id)).toEqual([id]);

    const restored = await as(ownerA, orgA).post(`/patients/${id}/restore`);
    expect(restored.status).toBe(200);
    expect(restored.body.patient).toMatchObject({ status: 'active', archivedAt: null });
    expect((await as(ownerA, orgA).post(`/patients/${id}/restore`)).status).toBe(409);
    expect((await as(staffA, orgA).patch(`/patients/${id}`, { fullName: 'Edited Again' })).status).toBe(200);
  });

  it('there is no DELETE endpoint', async () => {
    const id = await createPatient(ownerA, orgA, { fullName: 'Not Deletable' });
    const response = await request(app)
      .delete(`/patients/${id}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .set('X-Organization-Id', orgA);
    expect(response.status).toBe(404);
    expect(await adminDb.patient.count({ where: { id } })).toBe(1);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/patients').set('X-Organization-Id', orgA)).status).toBe(401);
  });
});

describe('patients — full stack: validation', () => {
  it.each([
    ['organizationId in the body', { fullName: 'X', organizationId: '00000000-0000-4000-8000-000000000000' }],
    ['createdBy in the body', { fullName: 'X', createdBy: '00000000-0000-4000-8000-000000000000' }],
    ['created already archived', { fullName: 'X', status: 'archived' }],
    ['a blank name', { fullName: '   ' }],
    ['no name', { email: 'x@example.test' }],
    ['an invalid email', { fullName: 'X', email: 'not-an-email' }],
    ['a future birth date', { fullName: 'X', dateOfBirth: '2999-01-01' }],
    ['an impossible birth date', { fullName: 'X', dateOfBirth: '1990-02-30' }],
    ['a birth date before 1900', { fullName: 'X', dateOfBirth: '1899-12-31' }],
    ['a phone with letters', { fullName: 'X', phone: 'call me' }],
    ['a 201-character name', { fullName: 'x'.repeat(201) }],
  ])('rejects %s on create with 400', async (_label, body) => {
    expect((await as(ownerA, orgA).post('/patients', body)).status).toBe(400);
  });

  it('rejects an empty or unknown-field PATCH, and status=archived via PATCH', async () => {
    const id = await createPatient(ownerA, orgA, { fullName: 'Patch Target' });
    expect((await as(ownerA, orgA).patch(`/patients/${id}`, {})).status).toBe(400);
    expect((await as(ownerA, orgA).patch(`/patients/${id}`, { organizationId: orgB })).status).toBe(400);
    expect((await as(ownerA, orgA).patch(`/patients/${id}`, { status: 'archived' })).status).toBe(400);
    expect((await as(ownerA, orgA).patch(`/patients/${id}`, { fullName: null })).status).toBe(400);
  });

  it('treats an empty optional field as "no value"', async () => {
    const created = await as(ownerA, orgA).post('/patients', {
      fullName: 'Empty Fields',
      email: '',
      phone: '',
      dateOfBirth: '',
      emergencyContactName: '  ',
    });
    expect(created.status).toBe(201);
    expect(created.body.patient).toMatchObject({
      email: null,
      phone: null,
      dateOfBirth: null,
      emergencyContactName: null,
    });
  });

  it.each([['page=0'], ['pageSize=101'], ['pageSize=abc'], ['status=deleted'], ['other=1']])(
    'rejects ?%s with 400',
    async (query) => {
      expect((await as(ownerA, orgA).get(`/patients?${query}`)).status).toBe(400);
    },
  );

  it('answers a malformed id like an unknown one: 404', async () => {
    expect((await as(ownerA, orgA).get('/patients/not-a-uuid')).status).toBe(404);
    expect((await as(ownerA, orgA).get('/patients/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });
});

describe('patients — full stack: list, pagination and search', () => {
  let listOwner: Member;

  beforeAll(async () => {
    // A fresh organization, so the counts below are exact.
    listOwner = await bootstrapUser(app, 'list-owner');
    for (let i = 1; i <= 25; i++) {
      await createPatient(listOwner, listOwner.organizationId, {
        fullName: `Paciente ${String(i).padStart(2, '0')}`,
        email: `paciente${i}@example.test`,
        phone: `+34 600 000 0${String(i).padStart(2, '0')}`,
      });
    }
    await createPatient(listOwner, listOwner.organizationId, { fullName: 'José 100% Literal_Name' });
  });

  const list = (query: string) => as(listOwner, listOwner.organizationId).get(`/patients?${query}`);

  it('pages through the list in name order with an exact total', async () => {
    const first = await list('pageSize=10');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 10, total: 26 });
    expect(first.body.patients[0].fullName).toBe('José 100% Literal_Name');
    expect(first.body.patients[1].fullName).toBe('Paciente 01');

    const third = await list('pageSize=10&page=3');
    expect(third.body.patients).toHaveLength(6);
    expect(third.body.patients.at(-1).fullName).toBe('Paciente 25');

    const beyond = await list('pageSize=10&page=4');
    expect(beyond.body).toMatchObject({ patients: [], total: 26 });

    const seen = new Set<string>();
    for (const page of [1, 2, 3]) {
      for (const p of (await list(`pageSize=10&page=${page}`)).body.patients) seen.add(p.id);
    }
    expect(seen.size).toBe(26);
  });

  it('defaults to 20 per page', async () => {
    expect((await list('')).body).toMatchObject({ pageSize: 20 });
    expect((await list('')).body.patients).toHaveLength(20);
  });

  it('searches name (case-insensitive), email and phone', async () => {
    expect((await list('q=PACIENTE 1')).body.total).toBe(10); // 10..19
    expect((await list('q=paciente7@')).body.patients.map((p: { fullName: string }) => p.fullName)).toEqual([
      'Paciente 07',
    ]);
    expect((await list('q=000 025')).body.patients.map((p: { fullName: string }) => p.fullName)).toEqual([
      'Paciente 25',
    ]);
    expect((await list('q=nobody')).body).toMatchObject({ patients: [], total: 0 });
  });

  it('treats LIKE wildcards in the search as literal characters', async () => {
    expect((await list('q=%25')).body.total).toBe(1); // "%"
    expect((await list('q=_')).body.total).toBe(1);
    expect((await list('q=0%25 L')).body.total).toBe(1);
    expect((await list('q=%5C')).body.total).toBe(0); // "\\" is escaped too, not an error
  });
});

describe('patients — full stack: cross-tenant isolation', () => {
  let patientOfA: string;

  beforeAll(async () => {
    patientOfA = await createPatient(ownerA, orgA, { fullName: 'Isolated Patient A' });
  });

  it('an outsider gets 404 for another organization’s patient, under their own organization', async () => {
    expect((await as(ownerB, orgB).get(`/patients/${patientOfA}`)).status).toBe(404);
    expect((await as(ownerB, orgB).patch(`/patients/${patientOfA}`, { fullName: 'Hijacked' })).status).toBe(404);
    expect((await as(ownerB, orgB).post(`/patients/${patientOfA}/archive`)).status).toBe(404);
    expect((await as(ownerB, orgB).post(`/patients/${patientOfA}/restore`)).status).toBe(404);
    const list = await as(ownerB, orgB).get('/patients?q=Isolated');
    expect(list.body).toMatchObject({ patients: [], total: 0 });
  });

  it('an outsider naming the other organization in the header gets 404 for everything', async () => {
    expect((await as(ownerB, orgA).get('/patients')).status).toBe(404);
    expect((await as(ownerB, orgA).get(`/patients/${patientOfA}`)).status).toBe(404);
    expect((await as(ownerB, orgA).post('/patients', { fullName: 'Planted' })).status).toBe(404);
  });

  it('nothing changed in organization A', async () => {
    const row = await adminDb.patient.findUniqueOrThrow({ where: { id: patientOfA } });
    expect(row).toMatchObject({ fullName: 'Isolated Patient A', status: 'active', organizationId: orgA });
    expect(await adminDb.patient.count({ where: { fullName: 'Planted' } })).toBe(0);
  });
});

describe('patients — RLS only (app layer removed)', () => {
  let patientOfA: string;

  beforeAll(async () => {
    patientOfA = await createPatient(ownerA, orgA, { fullName: 'Rls Patient A' });
    await createPatient(ownerB, orgB, { fullName: 'Rls Patient B' });
  });

  const asA = (user: TestUser) => ({ userId: user.id, organizationId: orgA });

  it('an outsider sees none of A’s patients, whichever organization they declare', async () => {
    for (const organizationId of [orgA, orgB]) {
      const rows = await asIdentity({ userId: ownerB.id, organizationId }, (tx) =>
        tx.patient.findMany({ where: { organizationId: orgA } }),
      );
      expect(rows).toEqual([]);
    }
  });

  it('a member sees only the declared organization, even when querying for another', async () => {
    const rows = await asIdentity(asA(ownerA), (tx) => tx.patient.findMany());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.organizationId === orgA)).toBe(true);
  });

  it('no identity or no declared organization sees nothing', async () => {
    expect(await asIdentity({ userId: ownerA.id }, (tx) => tx.patient.count())).toBe(0);
    expect(await runtimeDb.patient.count()).toBe(0);
  });

  it('a suspended member sees nothing and writes nothing', async () => {
    await adminDb.membership.update({
      where: { organizationId_userId: { organizationId: orgA, userId: psychA.id } },
      data: { status: 'suspended' },
    });
    try {
      expect(await asIdentity(asA(psychA), (tx) => tx.patient.count())).toBe(0);
      await expect(
        asIdentity(asA(psychA), (tx) =>
          tx.patient.create({ data: { organizationId: orgA, createdBy: psychA.id, fullName: 'Ghost' } }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
    } finally {
      await adminDb.membership.update({
        where: { organizationId_userId: { organizationId: orgA, userId: psychA.id } },
        data: { status: 'active' },
      });
    }
  });

  it('an outsider cannot insert into another organization', async () => {
    for (const organizationId of [orgA, orgB]) {
      await expect(
        asIdentity({ userId: ownerB.id, organizationId }, (tx) =>
          tx.patient.create({ data: { organizationId: orgA, createdBy: ownerB.id, fullName: 'Planted' } }),
        ),
      ).rejects.toThrow(RLS_VIOLATION);
    }
  });

  it('a member cannot record someone else as the creator', async () => {
    await expect(
      asIdentity(asA(staffA), (tx) =>
        tx.patient.create({ data: { organizationId: orgA, createdBy: ownerA.id, fullName: 'Spoofed' } }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('nobody, owner included, can insert a patient already archived', async () => {
    await expect(
      asIdentity(asA(ownerA), (tx) =>
        tx.patient.create({
          data: {
            organizationId: orgA,
            createdBy: ownerA.id,
            fullName: 'Pre-archived',
            status: 'archived',
            archivedAt: new Date(),
          },
        }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('an outsider cannot update A’s patients (matches zero rows)', async () => {
    const { count } = await asIdentity({ userId: ownerB.id, organizationId: orgA }, (tx) =>
      tx.patient.updateMany({ where: { id: patientOfA }, data: { fullName: 'Hijacked' } }),
    );
    expect(count).toBe(0);
  });

  it.each([
    ['admin_staff', () => staffA],
    ['psychologist', () => psychA],
  ])('%s cannot archive, edit an archived patient, or restore — even bypassing the API', async (_role, who) => {
    const user = who();
    const id = await createPatient(ownerA, orgA, { fullName: 'Rls Archive Target' });

    // Archive: the new row fails WITH CHECK.
    await expect(
      asIdentity(asA(user), (tx) =>
        tx.patient.updateMany({ where: { id }, data: { status: 'archived', archivedAt: new Date() } }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);

    await asIdentity(asA(ownerA), (tx) =>
      tx.patient.updateMany({ where: { id }, data: { status: 'archived', archivedAt: new Date() } }),
    );

    // Edit or restore an archived row: invisible to USING, zero rows.
    const edit = await asIdentity(asA(user), (tx) =>
      tx.patient.updateMany({ where: { id }, data: { fullName: 'Edited while archived' } }),
    );
    const restore = await asIdentity(asA(user), (tx) =>
      tx.patient.updateMany({ where: { id }, data: { status: 'active', archivedAt: null } }),
    );
    expect(edit.count).toBe(0);
    expect(restore.count).toBe(0);

    const row = await adminDb.patient.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'archived', fullName: 'Rls Archive Target' });
  });

  it('the owner can archive and restore through RLS (the policy is not simply closed)', async () => {
    const id = await createPatient(staffA, orgA, { fullName: 'Owner Archive Target' });
    const archived = await asIdentity(asA(ownerA), (tx) =>
      tx.patient.updateMany({ where: { id }, data: { status: 'archived', archivedAt: new Date() } }),
    );
    const restored = await asIdentity(asA(ownerA), (tx) =>
      tx.patient.updateMany({ where: { id }, data: { status: 'active', archivedAt: null } }),
    );
    expect([archived.count, restored.count]).toEqual([1, 1]);
  });

  it('nobody can delete a patient: no DELETE grant at all', async () => {
    await expect(
      asIdentity(asA(ownerA), (tx) => tx.patient.deleteMany({ where: { id: patientOfA } })),
    ).rejects.toThrow(PERMISSION_DENIED);
  });

  it.each([
    ['organizationId', () => ({ organizationId: orgB })],
    ['createdBy', () => ({ createdBy: staffA.id })],
    ['createdAt', () => ({ createdAt: new Date('2000-01-01') })],
  ])('nobody can rewrite %s: no column grant', async (_column, data) => {
    await expect(
      asIdentity(asA(ownerA), (tx) => tx.patient.updateMany({ where: { id: patientOfA }, data: data() })),
    ).rejects.toThrow(PERMISSION_DENIED);
  });
});

describe('patients — integrity, bypassing the app layer entirely', () => {
  const base = () => ({ organizationId: orgA, createdBy: ownerA.id, fullName: 'Integrity Patient' });

  it.each([
    ['archived without archived_at', { status: 'archived' as const }, /patients_archived_consistent/],
    ['archived_at on an active patient', { archivedAt: new Date() }, /patients_archived_consistent/],
    ['an un-normalized email', { email: 'Upper@Example.TEST' }, /patients_email_normalized/],
    ['a blank name', { fullName: ' ' }, /patients_full_name_valid/],
    ['a birth date before 1900', { dateOfBirth: new Date('1850-01-01') }, /patients_date_of_birth_plausible/],
    ['an over-long phone', { phone: '1'.repeat(31) }, /patients_phone_valid/],
  ])('the database rejects %s', async (_label, override, constraint) => {
    await expect(adminDb.patient.create({ data: { ...base(), ...override } })).rejects.toThrow(constraint);
  });

  it('the creator must be a member of the same organization (composite FK)', async () => {
    await expect(
      adminDb.patient.create({ data: { ...base(), createdBy: ownerB.id } }),
    ).rejects.toThrow(/Foreign key constraint/);
  });
});
