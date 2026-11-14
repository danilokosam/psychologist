import { createHash } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { prisma } from '../../src/shared/db/prisma';
import { adminDb, asIdentity, bootstrapUser, makeUser, resetDatabase, runtimeDb, type TestUser } from './helpers';

const app = createApp();
// Rejections must come from the policy itself, not incidentally from a
// foreign key or CHECK constraint that happens to fail first.
const RLS_VIOLATION = /row-level security/;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

type Owner = TestUser & { organizationId: string };

function invite(owner: Owner, body: object, organizationId = owner.organizationId) {
  return request(app)
    .post('/organizations/current/invitations')
    .set('Authorization', `Bearer ${owner.token}`)
    .set('X-Organization-Id', organizationId)
    .send(body);
}

function accept(user: TestUser, token: string) {
  return request(app)
    .post('/invitations/accept')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ token });
}

let ownerA: Owner;
let ownerB: Owner;

beforeEach(async () => {
  await resetDatabase();
  ownerA = await bootstrapUser(app, 'owner-a');
  ownerB = await bootstrapUser(app, 'owner-b');
});

afterAll(async () => {
  await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), runtimeDb.$disconnect()]);
});

describe('invitations -- full stack (API + RLS)', () => {
  it('owner invites; only the hash of the one-time token is stored', async () => {
    const response = await invite(ownerA, { email: 'New.Colleague@Example.test', role: 'psychologist' });

    expect(response.status).toBe(201);
    expect(response.body.invitation).toMatchObject({
      email: 'new.colleague@example.test',
      role: 'psychologist',
      status: 'pending',
    });
    const { token } = response.body;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const stored = await adminDb.invitation.findUniqueOrThrow({ where: { id: response.body.invitation.id } });
    expect(stored.tokenHash).toBe(sha256(token));
    expect(JSON.stringify(stored)).not.toContain(token);

    const list = await request(app)
      .get('/organizations/current/invitations')
      .set('Authorization', `Bearer ${ownerA.token}`)
      .set('X-Organization-Id', ownerA.organizationId);
    expect(list.status).toBe(200);
    expect(list.body.invitations).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toContain(stored.tokenHash);
  });

  it('refuses to invite an owner, and a duplicate pending invite', async () => {
    expect((await invite(ownerA, { email: 'x@example.test', role: 'owner' })).status).toBe(400);
    expect((await invite(ownerA, { email: 'x@example.test', role: 'admin_staff' })).status).toBe(201);
    expect((await invite(ownerA, { email: 'X@example.test', role: 'psychologist' })).status).toBe(409);
  });

  it('the invited user joins with exactly the invited role', async () => {
    const invitee = await makeUser('invitee');
    const { body } = await invite(ownerA, { email: invitee.email, role: 'admin_staff' });

    const accepted = await accept(invitee, body.token);

    expect(accepted.status).toBe(200);
    expect(accepted.body.organizationId).toBe(ownerA.organizationId);
    // Went straight to the link: no spurious solo practice was created.
    expect(accepted.body.account.memberships).toHaveLength(1);

    const current = await request(app)
      .get('/organizations/current')
      .set('Authorization', `Bearer ${invitee.token}`)
      .set('X-Organization-Id', ownerA.organizationId);
    expect(current.status).toBe(200);
    expect(current.body.role).toBe('admin_staff');

    const stored = await adminDb.invitation.findUniqueOrThrow({ where: { id: body.invitation.id } });
    expect(stored).toMatchObject({ status: 'accepted', acceptedBy: invitee.id });
  });

  it('a link is single-use', async () => {
    const invitee = await makeUser('invitee');
    const { body } = await invite(ownerA, { email: invitee.email, role: 'psychologist' });

    expect((await accept(invitee, body.token)).status).toBe(200);
    expect((await accept(invitee, body.token)).status).toBe(404);
  });

  it('a leaked link is useless to anyone but the invited address', async () => {
    const invitee = await makeUser('invitee');
    const mallory = await makeUser('mallory');
    const { body } = await invite(ownerA, { email: invitee.email, role: 'psychologist' });

    const response = await accept(mallory, body.token);

    expect(response.status).toBe(404);
    expect(await adminDb.membership.count({ where: { userId: mallory.id } })).toBe(0);
    expect(await adminDb.profile.count({ where: { id: mallory.id } })).toBe(0);
  });

  it('every failure answers the same 404', async () => {
    const invitee = await makeUser('invitee');
    const expired = await invite(ownerA, { email: invitee.email, role: 'psychologist' });
    await adminDb.invitation.update({
      where: { id: expired.body.invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 2000) },
    });

    const responses = [
      await accept(invitee, expired.body.token), // expired
      await accept(invitee, 'A'.repeat(43)), // unknown
      await accept(invitee, 'not-a-token'), // malformed
    ];

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Invitation not found' } });
    }
  });

  it('a revoked invitation cannot be accepted', async () => {
    const invitee = await makeUser('invitee');
    const { body } = await invite(ownerA, { email: invitee.email, role: 'psychologist' });

    const revoked = await request(app)
      .delete(`/organizations/current/invitations/${body.invitation.id}`)
      .set('Authorization', `Bearer ${ownerA.token}`)
      .set('X-Organization-Id', ownerA.organizationId);
    expect(revoked.status).toBe(204);

    expect((await accept(invitee, body.token)).status).toBe(404);
  });

  it('an existing member is told so, and keeps their role', async () => {
    const invitee = await makeUser('invitee');
    const first = await invite(ownerA, { email: invitee.email, role: 'admin_staff' });
    await accept(invitee, first.body.token);
    const second = await invite(ownerA, { email: invitee.email, role: 'psychologist' });

    expect((await accept(invitee, second.body.token)).status).toBe(409);
    const membership = await adminDb.membership.findFirstOrThrow({ where: { userId: invitee.id } });
    expect(membership.role).toBe('admin_staff');
  });

  it('non-owners are refused with 403, before anything is written', async () => {
    for (const role of ['psychologist', 'admin_staff'] as const) {
      const member = await makeUser(role);
      const { body } = await invite(ownerA, { email: member.email, role });
      await accept(member, body.token);
      const asMember = { ...member, organizationId: ownerA.organizationId };

      expect((await invite(asMember, { email: `by-${role}@example.test`, role: 'psychologist' })).status).toBe(403);
      const list = await request(app)
        .get('/organizations/current/invitations')
        .set('Authorization', `Bearer ${member.token}`)
        .set('X-Organization-Id', ownerA.organizationId);
      expect(list.status).toBe(403);
    }
    expect(await adminDb.invitation.count({ where: { email: { startsWith: 'by-' } } })).toBe(0);
  });

  it("another organization's owner gets 404 -- for inviting, listing and revoking", async () => {
    const { body } = await invite(ownerA, { email: 'someone@example.test', role: 'psychologist' });

    // Claiming org A as active organization: not a member -> 404.
    expect((await invite(ownerB, { email: 'x@example.test', role: 'psychologist' }, ownerA.organizationId)).status).toBe(404);

    // From their own org, trying to revoke A's invitation by id -> 404, untouched.
    const revoke = await request(app)
      .delete(`/organizations/current/invitations/${body.invitation.id}`)
      .set('Authorization', `Bearer ${ownerB.token}`)
      .set('X-Organization-Id', ownerB.organizationId);
    expect(revoke.status).toBe(404);
    const stored = await adminDb.invitation.findUniqueOrThrow({ where: { id: body.invitation.id } });
    expect(stored.status).toBe('pending');

    const listB = await request(app)
      .get('/organizations/current/invitations')
      .set('Authorization', `Bearer ${ownerB.token}`)
      .set('X-Organization-Id', ownerB.organizationId);
    expect(listB.body.invitations).toEqual([]);
  });
});

// The same guarantees with NO application code in front: connected as
// app_runtime, setting only identity variables -- i.e. what a future bug that
// skipped every middleware check would still run into.
describe('invitations -- RLS only (app layer removed)', () => {
  async function pendingInvitationTo(email: string, role: 'psychologist' | 'admin_staff' = 'psychologist') {
    const { body } = await invite(ownerA, { email, role });
    return body.invitation.id as string;
  }

  it("an outsider claiming the org sees none of its invitations", async () => {
    await pendingInvitationTo('someone@example.test');

    const rows = await asIdentity(
      { userId: ownerB.id, email: ownerB.email, organizationId: ownerA.organizationId },
      (tx) => tx.invitation.findMany({ where: { organizationId: ownerA.organizationId } }),
    );
    expect(rows).toEqual([]);
  });

  it('a non-owner member sees none of their own organization\'s invitations', async () => {
    const member = await makeUser('psych');
    const { body } = await invite(ownerA, { email: member.email, role: 'psychologist' });
    await accept(member, body.token);
    await pendingInvitationTo('other@example.test');

    const rows = await asIdentity(
      { userId: member.id, email: member.email, organizationId: ownerA.organizationId },
      (tx) => tx.invitation.findMany({ where: { status: 'pending' } }),
    );
    expect(rows).toEqual([]);
  });

  it('the invitee sees only invitations addressed to their own email', async () => {
    const invitee = await makeUser('invitee');
    await pendingInvitationTo(invitee.email);
    await pendingInvitationTo('someone-else@example.test');

    const rows = await asIdentity({ userId: invitee.id, email: invitee.email }, (tx) =>
      tx.invitation.findMany({ select: { email: true } }),
    );
    expect(rows).toEqual([{ email: invitee.email }]);
  });

  it('an outsider cannot create an invitation into another organization', async () => {
    await expect(
      asIdentity({ userId: ownerB.id, organizationId: ownerA.organizationId }, (tx) =>
        tx.invitation.create({
          data: {
            organizationId: ownerA.organizationId,
            email: 'accomplice@example.test',
            role: 'psychologist',
            tokenHash: 'f'.repeat(64),
            invitedBy: ownerB.id,
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it('no one can join without a live invitation for their email and that exact role', async () => {
    const invitee = await makeUser('invitee');
    await pendingInvitationTo(invitee.email, 'admin_staff');
    const tryJoin = (who: TestUser, role: 'owner' | 'psychologist' | 'admin_staff') =>
      asIdentity({ userId: who.id, email: who.email }, async (tx) => {
        await tx.profile.create({ data: { id: who.id } });
        return tx.membership.create({
          data: { organizationId: ownerA.organizationId, userId: who.id, role, status: 'active' },
        });
      });

    // Escalation attempts with a real invitation in hand:
    await expect(tryJoin(invitee, 'owner')).rejects.toThrow(RLS_VIOLATION);
    await expect(tryJoin(invitee, 'psychologist')).rejects.toThrow(RLS_VIOLATION);
    // A stranger with no invitation at all:
    await expect(tryJoin(await makeUser('stranger'), 'admin_staff')).rejects.toThrow(RLS_VIOLATION);
    // The legitimate case still works at this layer:
    await expect(tryJoin(invitee, 'admin_staff')).resolves.toMatchObject({ role: 'admin_staff' });
  });

  it('an expired invitation no longer opens the door', async () => {
    const invitee = await makeUser('invitee');
    const id = await pendingInvitationTo(invitee.email);
    await adminDb.invitation.update({
      where: { id },
      data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 2000) },
    });

    await expect(
      asIdentity({ userId: invitee.id, email: invitee.email }, async (tx) => {
        await tx.profile.create({ data: { id: invitee.id } });
        return tx.membership.create({
          data: { organizationId: ownerA.organizationId, userId: invitee.id, role: 'psychologist', status: 'active' },
        });
      }),
    ).rejects.toThrow(RLS_VIOLATION);
  });

  it("the invitee cannot rewrite the invitation's role or email (column grants)", async () => {
    const invitee = await makeUser('invitee');
    const id = await pendingInvitationTo(invitee.email);

    await expect(
      asIdentity({ userId: invitee.id, email: invitee.email }, (tx) =>
        tx.invitation.updateMany({ where: { id }, data: { role: 'admin_staff' } }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('nobody can delete an invitation, not even its owner', async () => {
    const id = await pendingInvitationTo('someone@example.test');

    await expect(
      asIdentity({ userId: ownerA.id, organizationId: ownerA.organizationId }, (tx) =>
        tx.invitation.deleteMany({ where: { id } }),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('an owner can revoke but cannot mark an invitation accepted on someone\'s behalf', async () => {
    const id = await pendingInvitationTo('someone@example.test');

    await expect(
      asIdentity({ userId: ownerA.id, organizationId: ownerA.organizationId }, (tx) =>
        tx.invitation.updateMany({
          where: { id },
          data: { status: 'accepted', acceptedBy: ownerA.id, acceptedAt: new Date() },
        }),
      ),
    ).rejects.toThrow(RLS_VIOLATION);
  });
});
