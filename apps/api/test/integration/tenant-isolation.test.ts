import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/shared/db/prisma';
import {
  adminDb,
  asIdentity,
  bootstrapUser,
  makeUser,
  resetDatabase,
  runtimeDb,
  signToken,
  type TestUser,
} from './helpers';

/**
 * Milestone 1 definition of done: two seeded organizations, cross-tenant
 * isolation proven at BOTH layers (docs/SECURITY.md):
 *   - full stack: through the API, middleware and RLS together;
 *   - RLS only: as app_runtime with nothing but identity variables set, i.e.
 *     what a future application bug that skipped every check would face.
 *
 * Seeded through the real flows (bootstrap + invitations), not by inserting
 * rows directly, so the fixtures themselves exercise the code under test.
 *
 *   Org A: ownerA (owner), psychA (psychologist), staffA (admin_staff)
 *   Org B: ownerB (owner)
 *   multi: owner of their own practice AND admin_staff in Org A (F-003)
 */

const app = createApp();

type Member = TestUser & { organizationId: string };
let ownerA: Member;
let ownerB: Member;
let psychA: TestUser;
let staffA: TestUser;
let multi: Member;

async function inviteInto(owner: Member, role: 'psychologist' | 'admin_staff', user: TestUser) {
  const created = await request(app)
    .post('/organizations/current/invitations')
    .set('Authorization', `Bearer ${owner.token}`)
    .set('X-Organization-Id', owner.organizationId)
    .send({ email: user.email, role });
  const accepted = await request(app)
    .post('/invitations/accept')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ token: created.body.token });
  if (accepted.status !== 200) throw new Error(`seeding ${role} failed: ${accepted.status}`);
}

const current = (user: TestUser, organizationId: string) =>
  request(app)
    .get('/organizations/current')
    .set('Authorization', `Bearer ${user.token}`)
    .set('X-Organization-Id', organizationId);

beforeAll(async () => {
  await resetDatabase();
  ownerA = await bootstrapUser(app, 'owner-a');
  ownerB = await bootstrapUser(app, 'owner-b');
  psychA = await makeUser('psych-a');
  staffA = await makeUser('staff-a');
  await inviteInto(ownerA, 'psychologist', psychA);
  await inviteInto(ownerA, 'admin_staff', staffA);
  multi = await bootstrapUser(app, 'multi');
  await inviteInto(ownerA, 'admin_staff', multi);
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), runtimeDb.$disconnect()]);
});

describe('seed sanity', () => {
  it('has exactly the two-organization shape the tests assume', async () => {
    const counts = await adminDb.membership.groupBy({ by: ['organizationId'], _count: true });
    const byOrg = Object.fromEntries(counts.map((c) => [c.organizationId, c._count]));
    expect(byOrg[ownerA.organizationId]).toBe(4); // ownerA, psychA, staffA, multi
    expect(byOrg[ownerB.organizationId]).toBe(1);
  });
});

describe('full stack (API + RLS)', () => {
  it.each([
    ['ownerA', () => ownerA, 'owner'],
    ['psychA', () => psychA, 'psychologist'],
    ['staffA', () => staffA, 'admin_staff'],
  ] as const)('%s reads Org A with their DB-verified role', async (_label, who, role) => {
    const response = await current(who(), ownerA.organizationId);
    expect(response.status).toBe(200);
    expect(response.body.role).toBe(role);
  });

  it('every Org A member gets 404 -- not 403 -- for Org B', async () => {
    for (const user of [ownerA, psychA, staffA]) {
      const response = await current(user, ownerB.organizationId);
      expect(response.status).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    }
  });

  it('Org B owner gets 404 for Org A, identical to a nonexistent organization', async () => {
    const real = await current(ownerB, ownerA.organizationId);
    const fake = await current(ownerB, '00000000-0000-4000-8000-000000000000');
    expect(real.status).toBe(404);
    expect(real.body).toEqual(fake.body);
  });

  it('/me never lists another organization\'s members or memberships', async () => {
    const me = await request(app).get('/me').set('Authorization', `Bearer ${ownerB.token}`);
    expect(me.body.memberships.map((m: { organizationId: string }) => m.organizationId)).toEqual([
      ownerB.organizationId,
    ]);
  });

  it('rejects a missing or malformed X-Organization-Id with 400', async () => {
    const none = await request(app).get('/organizations/current').set('Authorization', `Bearer ${ownerA.token}`);
    expect(none.status).toBe(400);
    expect((await current(ownerA, 'not-a-uuid')).status).toBe(400);
  });

  describe('F-003: one user, several organizations', () => {
    it('lists both memberships', async () => {
      const me = await request(app).get('/me').set('Authorization', `Bearer ${multi.token}`);
      const roles = Object.fromEntries(
        me.body.memberships.map((m: { organizationId: string; role: string }) => [m.organizationId, m.role]),
      );
      expect(roles).toEqual({ [multi.organizationId]: 'owner', [ownerA.organizationId]: 'admin_staff' });
    });

    it('switching the active organization switches the role -- each verified separately', async () => {
      expect((await current(multi, multi.organizationId)).body.role).toBe('owner');
      expect((await current(multi, ownerA.organizationId)).body.role).toBe('admin_staff');
    });

    it('being owner elsewhere grants nothing in Org A', async () => {
      const response = await request(app)
        .get('/organizations/current/invitations')
        .set('Authorization', `Bearer ${multi.token}`)
        .set('X-Organization-Id', ownerA.organizationId);
      expect(response.status).toBe(403);
    });

    it('the database rejects a duplicate membership, even bypassing the app', async () => {
      await expect(
        adminDb.membership.create({
          data: { organizationId: ownerA.organizationId, userId: multi.id, role: 'psychologist' },
        }),
      ).rejects.toThrow(/Unique constraint/);
    });
  });

  it('a suspended member loses access immediately', async () => {
    const suspended = await makeUser('suspended');
    await inviteInto(ownerA, 'psychologist', suspended);
    expect((await current(suspended, ownerA.organizationId)).status).toBe(200);

    await adminDb.membership.update({
      where: { organizationId_userId: { organizationId: ownerA.organizationId, userId: suspended.id } },
      data: { status: 'suspended' },
    });

    expect((await current(suspended, ownerA.organizationId)).status).toBe(404);
  });
});

describe('authentication -- rejected before any membership lookup', () => {
  const expectRejected = async (token: string) => {
    const response = await current({ ...ownerA, token }, ownerA.organizationId);
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: 'Invalid or expired token' } });
  };

  it('expired token', async () => {
    await expectRejected(
      await signToken({ sub: ownerA.id, email: ownerA.email }, { expiresIn: Math.floor(Date.now() / 1000) - 60 }),
    );
  });

  it('tampered token (payload changed to impersonate another user, signature kept)', async () => {
    const [header = '', payload = '', signature = ''] = ownerB.token.split('.');
    // Only `sub` changes; issuer, expiry and everything else stay valid, so
    // the signature check is the only thing that can catch it.
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: ownerA.id })).toString('base64url');
    await expectRejected(`${header}.${forged}.${signature}`);
  });

  it('unsigned token (alg: none)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: ownerA.id, exp: 9999999999 })).toString('base64url');
    await expectRejected(`${header}.${payload}.`);
  });

  it('validly signed token from a different issuer', async () => {
    await expectRejected(await signToken({ sub: ownerA.id }, { issuer: 'https://other-project.supabase.co/auth/v1' }));
  });
});

describe('RLS only (app layer removed)', () => {
  it('with no identity at all, every table reads as empty -- fail closed', async () => {
    const counts = await runtimeDb.$transaction(async (tx) => [
      await tx.organization.count(),
      await tx.membership.count(),
      await tx.profile.count(),
      await tx.invitation.count(),
    ]);
    expect(counts).toEqual([0, 0, 0, 0]);
  });

  it('Org B owner, even claiming Org A as active, sees nothing of Org A', async () => {
    const seen = await asIdentity({ userId: ownerB.id, organizationId: ownerA.organizationId }, async (tx) => ({
      organization: await tx.organization.findUnique({ where: { id: ownerA.organizationId } }),
      memberships: await tx.membership.count({ where: { organizationId: ownerA.organizationId } }),
      profiles: await tx.profile.count({ where: { id: { in: [ownerA.id, psychA.id, staffA.id] } } }),
    }));
    expect(seen).toEqual({ organization: null, memberships: 0, profiles: 0 });
  });

  it('an Org A member sees teammates, and only teammates', async () => {
    const visible = await asIdentity({ userId: psychA.id, organizationId: ownerA.organizationId }, (tx) =>
      tx.profile.findMany({ select: { id: true } }),
    );
    const ids = visible.map((p) => p.id).sort();
    expect(ids).toEqual([ownerA.id, psychA.id, staffA.id, multi.id].sort());
    expect(ids).not.toContain(ownerB.id);
  });

  it('nobody outside the owner role can rename Org A; outsiders cannot even find it', async () => {
    for (const [userId, organizationId] of [
      [ownerB.id, ownerA.organizationId],
      [psychA.id, ownerA.organizationId],
      [staffA.id, ownerA.organizationId],
    ] as const) {
      const { count } = await asIdentity({ userId, organizationId }, (tx) =>
        tx.organization.updateMany({ where: { id: ownerA.organizationId }, data: { name: 'Hijacked' } }),
      );
      expect(count).toBe(0);
    }
    const org = await adminDb.organization.findUniqueOrThrow({ where: { id: ownerA.organizationId } });
    expect(org.name).not.toBe('Hijacked');
  });

  it('a member cannot add someone else to their organization', async () => {
    await expect(
      asIdentity({ userId: ownerA.id, organizationId: ownerA.organizationId }, (tx) =>
        tx.membership.create({
          data: { organizationId: ownerA.organizationId, userId: ownerB.id, role: 'owner', status: 'active' },
        }),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('nobody can delete memberships or organizations through the runtime role', async () => {
    const result = await asIdentity({ userId: ownerA.id, organizationId: ownerA.organizationId }, async (tx) => ({
      memberships: (await tx.membership.deleteMany({ where: { organizationId: ownerA.organizationId } })).count,
      organizations: (await tx.organization.deleteMany({ where: { id: ownerA.organizationId } })).count,
    }));
    // No DELETE policies exist, so even the owner's own rows are untouchable.
    expect(result).toEqual({ memberships: 0, organizations: 0 });
  });

  it('a suspended member is no longer recognised by the database either', async () => {
    const formerMember = await makeUser('former');
    await inviteInto(ownerA, 'psychologist', formerMember);
    await adminDb.membership.update({
      where: { organizationId_userId: { organizationId: ownerA.organizationId, userId: formerMember.id } },
      data: { status: 'suspended' },
    });

    const seen = await asIdentity({ userId: formerMember.id, organizationId: ownerA.organizationId }, async (tx) => ({
      organization: await tx.organization.findUnique({ where: { id: ownerA.organizationId } }),
      others: await tx.membership.count({ where: { organizationId: ownerA.organizationId, NOT: { userId: formerMember.id } } }),
    }));
    expect(seen).toEqual({ organization: null, others: 0 });
  });
});
