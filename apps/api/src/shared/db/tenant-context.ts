import type { Prisma } from '@psych/db';
import { prisma } from './prisma';

/** Verified identity of the caller, taken from the access token -- never from client input. */
export type UserContext = { userId: string };

/** Verified identity plus the organization the caller has an active membership in. */
export type TenantContext = UserContext & { organizationId: string };

export type Tx = Prisma.TransactionClient;

/**
 * Runs `fn` inside a transaction that carries the caller's identity into
 * Postgres, so Row Level Security policies can evaluate against it.
 *
 * Only *identity* is passed down (user id, organization id) -- never an
 * authorization conclusion like a role. The policies re-derive roles
 * themselves from the `memberships` table, which is what makes RLS an
 * independent second check rather than a mirror of the application's own
 * decision. See ADR-0003.
 *
 * `set_config(..., true)` is transaction-scoped, which is exactly why this
 * works through Supavisor in transaction mode: the pooler hands us one
 * dedicated backend connection for the life of the transaction and resets it
 * afterwards, matching the lifetime of these settings precisely.
 *
 * Keep the callback to database work only. Slow non-DB I/O (sending email,
 * calling Stripe) belongs after the transaction resolves -- an open
 * transaction holds a pooled connection the whole time.
 */
export async function withTenantContext<T>(
  context: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setIdentity(tx, context.userId);
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${context.organizationId}, true)`;
    return fn(tx);
  });
}

/**
 * Same as withTenantContext, but for the queries that legitimately happen
 * *before* an organization is selected: bootstrapping the caller's own
 * profile, and listing which organizations they belong to so the UI can
 * offer a choice. `app.current_org_id` is deliberately left unset, so any
 * org-scoped policy fails closed during these queries.
 */
export async function withUserContext<T>(
  context: UserContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await setIdentity(tx, context.userId);
    return fn(tx);
  });
}

function setIdentity(tx: Tx, userId: string) {
  return tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
}
