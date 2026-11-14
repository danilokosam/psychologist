import { describe, expect, it } from 'vitest';
import type { Membership, Profile } from '../../../accounts/domain/account';
import type { AccountRepository } from '../../../accounts/application/ports/account-repository';
import type { Invitation } from '../../domain/invitation';
import type { InvitationRepository, InvitationTokens } from '../ports/invitation-repository';
import { acceptInvitation } from './accept-invitation';
import { createInvitation } from './create-invitation';

const ORG = '22222222-2222-4222-8222-222222222222';
const OWNER = '11111111-1111-4111-8111-111111111111';
const INVITEE = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-14T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const tokens: InvitationTokens = {
  generate: () => ({ token: 'plain-token', tokenHash: 'hash:plain-token' }),
  hash: (token) => `hash:${token}`,
};

type StoredInvitation = Invitation & { tokenHash: string; acceptedBy?: string };

function fakes(seed: { invitations?: StoredInvitation[]; profile?: Profile; memberships?: Membership[] } = {}) {
  const state = {
    invitations: [...(seed.invitations ?? [])],
    profile: seed.profile ?? null,
    memberships: [...(seed.memberships ?? [])],
  };

  const invitations: InvitationRepository = {
    findPendingByEmail: async (organizationId, email) =>
      state.invitations.find(
        (i) => i.organizationId === organizationId && i.email === email && i.status === 'pending',
      ) ?? null,
    insert: async (record) => {
      const invitation: StoredInvitation = {
        id: `inv-${state.invitations.length + 1}`,
        organizationId: record.organizationId,
        email: record.email,
        role: record.role,
        status: 'pending',
        expiresAt: record.expiresAt,
        createdAt: NOW,
        tokenHash: record.tokenHash,
      };
      state.invitations.push(invitation);
      return invitation;
    },
    listPending: async (organizationId) =>
      state.invitations.filter((i) => i.organizationId === organizationId && i.status === 'pending'),
    revoke: async ({ invitationId }) => {
      const invitation = state.invitations.find((i) => i.id === invitationId && i.status === 'pending');
      if (!invitation) return false;
      invitation.status = 'revoked';
      return true;
    },
    findByTokenHash: async (tokenHash) => state.invitations.find((i) => i.tokenHash === tokenHash) ?? null,
    addMember: async ({ organizationId, role }) => {
      state.memberships.push({
        organizationId,
        role,
        status: 'active',
        organization: { id: organizationId, name: 'Clinic', slug: 'clinic' },
      });
    },
    markAccepted: async ({ invitationId, userId }) => {
      const invitation = state.invitations.find((i) => i.id === invitationId)!;
      invitation.status = 'accepted';
      invitation.acceptedBy = userId;
    },
  };

  const accounts: AccountRepository = {
    findProfile: async () => state.profile,
    insertProfile: async ({ userId, fullName }) => {
      state.profile = { id: userId, fullName, locale: 'en' };
      return state.profile;
    },
    listMemberships: async () => state.memberships,
    updateLocale: async () => state.profile,
    lockAccount: async () => {},
    insertOrganizationWithOwner: async () => {
      throw new Error('accepting an invitation must never create an organization');
    },
  };

  return { state, invitations, accounts };
}

function pendingInvitation(overrides: Partial<StoredInvitation> = {}): StoredInvitation {
  return {
    id: 'inv-existing',
    organizationId: ORG,
    email: 'ana@example.test',
    role: 'psychologist',
    status: 'pending',
    expiresAt: new Date(NOW.getTime() + DAY),
    createdAt: new Date(NOW.getTime() - DAY),
    tokenHash: 'hash:good-token',
    ...overrides,
  };
}

describe('createInvitation', () => {
  it('stores only the token hash, normalizes the email and expires in 7 days', async () => {
    const { state, invitations } = fakes();

    const result = await createInvitation(
      { organizationId: ORG, invitedBy: OWNER, email: '  Ana@Example.TEST ', role: 'admin_staff', now: NOW },
      { invitations, tokens },
    );

    expect(result.kind).toBe('created');
    if (result.kind !== 'created') return;
    expect(result.token).toBe('plain-token');
    expect(state.invitations[0]?.tokenHash).toBe('hash:plain-token');
    expect(result.invitation.email).toBe('ana@example.test');
    expect(result.invitation.expiresAt.getTime() - NOW.getTime()).toBe(7 * DAY);
  });

  it('rejects a second live invitation for the same email', async () => {
    const { invitations } = fakes({ invitations: [pendingInvitation()] });

    const result = await createInvitation(
      { organizationId: ORG, invitedBy: OWNER, email: 'ana@example.test', role: 'psychologist', now: NOW },
      { invitations, tokens },
    );

    expect(result).toEqual({ kind: 'duplicate' });
  });

  it('retires an expired pending invitation instead of blocking a re-invite', async () => {
    const expired = pendingInvitation({ expiresAt: new Date(NOW.getTime() - 1) });
    const { state, invitations } = fakes({ invitations: [expired] });

    const result = await createInvitation(
      { organizationId: ORG, invitedBy: OWNER, email: 'ana@example.test', role: 'psychologist', now: NOW },
      { invitations, tokens },
    );

    expect(result.kind).toBe('created');
    expect(state.invitations.map((i) => i.status)).toEqual(['revoked', 'pending']);
  });
});

describe('acceptInvitation', () => {
  const accept = (deps: ReturnType<typeof fakes>, overrides: { email?: string | undefined; token?: string; now?: Date } = {}) =>
    acceptInvitation(
      {
        userId: INVITEE,
        email: 'email' in overrides ? overrides.email : 'ana@example.test',
        token: overrides.token ?? 'good-token',
        fullName: 'Ana Ruiz',
        now: overrides.now ?? NOW,
      },
      { invitations: deps.invitations, accounts: deps.accounts, tokens },
    );

  it('creates the profile and an active membership with the invited role', async () => {
    const deps = fakes({ invitations: [pendingInvitation()] });

    const result = await accept(deps);

    expect(result.kind).toBe('accepted');
    expect(deps.state.profile).toEqual({ id: INVITEE, fullName: 'Ana Ruiz', locale: 'en' });
    expect(deps.state.memberships).toHaveLength(1);
    expect(deps.state.memberships[0]).toMatchObject({ organizationId: ORG, role: 'psychologist', status: 'active' });
    expect(deps.state.invitations[0]).toMatchObject({ status: 'accepted', acceptedBy: INVITEE });
  });

  it('matches the email case-insensitively', async () => {
    const deps = fakes({ invitations: [pendingInvitation()] });
    expect((await accept(deps, { email: 'ANA@example.test' })).kind).toBe('accepted');
  });

  // Every failure mode must look identical to the caller.
  it.each([
    ['unknown token', { token: 'other-token' }, pendingInvitation()],
    ['someone else holding the link', { email: 'mallory@example.test' }, pendingInvitation()],
    ['a token with no email claim', { email: undefined }, pendingInvitation()],
    ['an expired invitation', {}, pendingInvitation({ expiresAt: new Date(NOW.getTime() - 1) })],
    ['a revoked invitation', {}, pendingInvitation({ status: 'revoked' })],
    ['an already used invitation', {}, pendingInvitation({ status: 'accepted' })],
  ] as const)('not_found for %s, with nothing written', async (_label, overrides, invitation) => {
    const deps = fakes({ invitations: [invitation] });

    const result = await accept(deps, overrides);

    expect(result).toEqual({ kind: 'not_found' });
    expect(deps.state.memberships).toHaveLength(0);
    expect(deps.state.profile).toBeNull();
  });

  it('already_member when the caller already belongs to the organization', async () => {
    const deps = fakes({
      invitations: [pendingInvitation()],
      profile: { id: INVITEE, fullName: 'Ana', locale: 'es' },
      memberships: [
        { organizationId: ORG, role: 'admin_staff', status: 'active', organization: { id: ORG, name: 'C', slug: 'c' } },
      ],
    });

    expect(await accept(deps)).toEqual({ kind: 'already_member' });
    expect(deps.state.invitations[0]?.status).toBe('pending');
  });
});
