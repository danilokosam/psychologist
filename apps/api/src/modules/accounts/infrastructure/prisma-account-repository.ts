import { randomUUID } from 'node:crypto';
import type { MembershipRole, MembershipStatus, SupportedLocale } from '@psych/types';
import type { Tx } from '../../../shared/db/tenant-context';
import type { Membership, Organization, Profile } from '../domain/account';
import type { AccountRepository } from '../application/ports/account-repository';

// Shapes of the rows this adapter reads, kept local so Prisma's generated
// types never leak out of the infrastructure layer.
type ProfileRow = { id: string; fullName: string | null; locale: string };
type MembershipRow = {
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
  organization: { id: string; name: string; slug: string };
};

/**
 * Prisma-backed implementation of AccountRepository.
 *
 * Takes the request's transaction client, so every query it issues runs
 * inside the transaction that set the caller's identity session variables --
 * there is no way to accidentally query outside the RLS context (ADR-0002).
 */
export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly tx: Tx) {}

  async lockAccount(userId: string): Promise<void> {
    // Transaction-scoped advisory lock keyed on the user: a second concurrent
    // bootstrap for the same user waits here until the first commits, then
    // reads the profile/membership the first one wrote. Other users are never
    // blocked (different key). Released automatically at commit/rollback, so
    // it's safe through the transaction-mode pooler -- unlike a session lock,
    // it can't leak onto a recycled connection. `hashtextextended` maps the
    // id to the bigint key the lock function takes; the prefix keeps these
    // keys apart from any other advisory lock added later.
    await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`account:${userId}`}, 0))`;
  }

  async findProfile(userId: string): Promise<Profile | null> {
    const row = await this.tx.profile.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, locale: true },
    });
    return row ? toProfile(row) : null;
  }

  async insertProfile(input: { userId: string; fullName: string | null }): Promise<Profile> {
    const row = await this.tx.profile.create({
      // Explicit field list, never a spread of client input. `id` is the
      // verified user id from the token -- the profiles_self_insert policy
      // independently rejects any other value.
      data: {
        id: input.userId,
        fullName: input.fullName,
      },
      select: { id: true, fullName: true, locale: true },
    });
    return toProfile(row);
  }

  async updateLocale(input: { userId: string; locale: SupportedLocale }): Promise<Profile | null> {
    // updateMany, not update: zero matched rows (no profile yet -- or, if this
    // were ever called with someone else's id, RLS hiding their row) is a
    // normal "not found" here, not an exception.
    const { count } = await this.tx.profile.updateMany({
      where: { id: input.userId },
      data: { locale: input.locale },
    });
    return count === 1 ? this.findProfile(input.userId) : null;
  }

  async listMemberships(userId: string): Promise<Membership[]> {
    const rows = await this.tx.membership.findMany({
      where: { userId },
      select: {
        organizationId: true,
        role: true,
        status: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toMembership);
  }

  async insertOrganizationWithOwner(input: {
    userId: string;
    name: string;
    slug: string;
  }): Promise<Membership> {
    // The id is generated here rather than by the database so the membership
    // insert below can reference it. `created_by` is what makes the row
    // visible to its creator under the organizations_select policy before any
    // membership exists -- see the migration that added it.
    const organizationId = randomUUID();

    await this.tx.organization.create({
      data: {
        id: organizationId,
        name: input.name,
        slug: input.slug,
        createdBy: input.userId,
      },
      select: { id: true },
    });

    const row = await this.tx.membership.create({
      data: {
        organizationId,
        userId: input.userId,
        role: 'owner',
        status: 'active',
      },
      select: {
        organizationId: true,
        role: true,
        status: true,
        organization: { select: { id: true, name: true, slug: true } },
      },
    });

    return toMembership(row);
  }
}

function toProfile(row: ProfileRow): Profile {
  return { id: row.id, fullName: row.fullName, locale: row.locale };
}

function toOrganization(row: { id: string; name: string; slug: string }): Organization {
  return { id: row.id, name: row.name, slug: row.slug };
}

function toMembership(row: MembershipRow): Membership {
  return {
    organizationId: row.organizationId,
    role: row.role,
    status: row.status,
    organization: toOrganization(row.organization),
  };
}
