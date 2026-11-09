import { describe, expect, it } from 'vitest';
import type { Membership, Profile } from '../../domain/account';
import type { AccountRepository } from '../ports/account-repository';
import { bootstrapAccount } from './bootstrap-account';

const USER_ID = '11111111-1111-4111-8111-111111111111';

// The whole point of the port in ADR-0009: this use case is tested with no
// database, no Prisma, no Express -- just an in-memory stand-in.
function fakeRepository(seed: { profile?: Profile; memberships?: Membership[] } = {}) {
  const state = {
    profile: seed.profile ?? null,
    memberships: seed.memberships ?? [],
    inserts: { profiles: 0, organizations: 0 },
  };

  const repository: AccountRepository = {
    findProfile: async () => state.profile,
    insertProfile: async ({ userId, fullName }) => {
      state.inserts.profiles += 1;
      state.profile = { id: userId, fullName, locale: 'en' };
      return state.profile;
    },
    listMemberships: async () => state.memberships,
    insertOrganizationWithOwner: async ({ userId: _userId, name, slug }) => {
      state.inserts.organizations += 1;
      const membership: Membership = {
        organizationId: '22222222-2222-4222-8222-222222222222',
        role: 'owner',
        status: 'active',
        organization: { id: '22222222-2222-4222-8222-222222222222', name, slug },
      };
      state.memberships = [membership];
      return membership;
    },
  };

  return { repository, state };
}

describe('bootstrapAccount', () => {
  it('creates a profile and a solo practice owned by the new user', async () => {
    const { repository, state } = fakeRepository();

    const account = await bootstrapAccount(
      { userId: USER_ID, fullName: 'Ana Ruiz', organizationName: 'Consulta Ana', slugSuffix: 'abc12345' },
      { accounts: repository },
    );

    expect(account.profile).toEqual({ id: USER_ID, fullName: 'Ana Ruiz', locale: 'en' });
    expect(account.memberships).toHaveLength(1);
    expect(account.memberships[0]?.role).toBe('owner');
    expect(account.memberships[0]?.organization.name).toBe('Consulta Ana');
    expect(account.memberships[0]?.organization.slug).toBe('consulta-ana-abc12345');
    expect(state.inserts).toEqual({ profiles: 1, organizations: 1 });
  });

  it('is idempotent -- a second call creates nothing', async () => {
    const existingProfile: Profile = { id: USER_ID, fullName: 'Ana Ruiz', locale: 'es' };
    const existingMembership: Membership = {
      organizationId: '33333333-3333-4333-8333-333333333333',
      role: 'owner',
      status: 'active',
      organization: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Consulta Ana',
        slug: 'consulta-ana-old',
      },
    };
    const { repository, state } = fakeRepository({
      profile: existingProfile,
      memberships: [existingMembership],
    });

    const account = await bootstrapAccount(
      { userId: USER_ID, slugSuffix: 'ignored1' },
      { accounts: repository },
    );

    expect(account.profile).toEqual(existingProfile);
    expect(account.memberships).toEqual([existingMembership]);
    expect(state.inserts).toEqual({ profiles: 0, organizations: 0 });
  });

  it('still creates an organization for a profile that somehow has none', async () => {
    const { repository, state } = fakeRepository({
      profile: { id: USER_ID, fullName: null, locale: 'en' },
    });

    const account = await bootstrapAccount(
      { userId: USER_ID, slugSuffix: 'abc12345' },
      { accounts: repository },
    );

    // Falls back to a neutral name; the frontend normally supplies a
    // localized one.
    expect(account.memberships[0]?.organization.slug).toBe('practice-abc12345');
    expect(state.inserts).toEqual({ profiles: 0, organizations: 1 });
  });
});
