import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { bootstrapAccount } from '../../src/modules/accounts/application/use-cases/bootstrap-account';
import type { AccountRepository } from '../../src/modules/accounts/application/ports/account-repository';
import { PrismaAccountRepository } from '../../src/modules/accounts/infrastructure/prisma-account-repository';
import { prisma } from '../../src/shared/db/prisma';
import { withUserContext } from '../../src/shared/db/tenant-context';
import { adminDb, makeUser, resetDatabase, runtimeDb } from './helpers';

/**
 * Regression test for a race found during the Milestone 1 browser pass:
 * React Strict Mode (and two open tabs) send POST /auth/bootstrap twice at
 * once for a brand-new user. Both transactions read "no profile, no
 * membership", then both write -- the second hit a unique violation (500),
 * and in the profile-exists-but-no-membership case both would have created a
 * solo practice.
 *
 * Over a fast local connection the two requests rarely overlap, so instead
 * of hoping for bad timing this forces the bad interleaving: each transaction
 * waits at a barrier right after its first read until the other has also
 * read (or a short timeout passes -- which is what happens once the fix
 * serializes them, because the second can't even start reading).
 */
function barrier(parties: number, timeoutMs: number) {
  let arrived = 0;
  let release!: () => void;
  const open = new Promise<void>((resolve) => (release = resolve));
  return async () => {
    arrived += 1;
    if (arrived >= parties) release();
    await Promise.race([open, new Promise((r) => setTimeout(r, timeoutMs))]);
  };
}

function withBarrierAfterFirstRead(repo: AccountRepository, wait: () => Promise<void>): AccountRepository {
  return {
    lockAccount: (userId) => repo.lockAccount(userId),
    findProfile: async (userId) => {
      const result = await repo.findProfile(userId);
      await wait();
      return result;
    },
    insertProfile: (input) => repo.insertProfile(input),
    listMemberships: (userId) => repo.listMemberships(userId),
    updateLocale: (input) => repo.updateLocale(input),
    insertOrganizationWithOwner: (input) => repo.insertOrganizationWithOwner(input),
  };
}

beforeEach(resetDatabase);
afterAll(async () => {
  await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), runtimeDb.$disconnect()]);
});

describe('bootstrapAccount under concurrency', () => {
  it('two simultaneous first sign-ins yield one profile and one practice, and both succeed', async () => {
    const user = await makeUser('racer');
    const wait = barrier(2, 1_000);

    const run = (suffix: string) =>
      withUserContext({ userId: user.id }, (tx) =>
        bootstrapAccount(
          { userId: user.id, organizationName: 'Race Practice', slugSuffix: suffix },
          { accounts: withBarrierAfterFirstRead(new PrismaAccountRepository(tx), wait) },
        ),
      );

    const results = await Promise.allSettled([run('aaaa1111'), run('bbbb2222')]);

    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(await adminDb.profile.count({ where: { id: user.id } })).toBe(1);
    expect(await adminDb.organization.count({ where: { createdBy: user.id } })).toBe(1);
    expect(await adminDb.membership.count({ where: { userId: user.id } })).toBe(1);
  });
});
