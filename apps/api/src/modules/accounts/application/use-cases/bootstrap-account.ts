import { FALLBACK_ORGANIZATION_NAME, organizationSlug, type Account } from '../../domain/account';
import type { AccountRepository } from '../ports/account-repository';

export type BootstrapAccountInput = {
  /** Verified caller identity -- from the access token, never from the request body. */
  userId: string;
  fullName?: string | undefined;
  organizationName?: string | undefined;
  /** Suffix that makes the generated slug unique; injected so this stays deterministic in tests. */
  slugSuffix: string;
};

/**
 * Makes a freshly signed-up Supabase Auth user usable by the application.
 *
 * Supabase creates the `auth.users` row; nothing creates the matching
 * `public.profiles` row or an organization to work in. (A trigger on
 * `auth.users` would be the usual Supabase answer, but custom roles can't
 * touch that schema -- see ADR-0011 -- so the application does it.)
 *
 * The business rule: a new user gets their own solo practice and is its
 * `owner`. Implemented idempotently, because the frontend calls this on every
 * sign-in rather than trying to detect "is this the first time".
 */
export async function bootstrapAccount(
  input: BootstrapAccountInput,
  deps: { accounts: AccountRepository },
): Promise<Account> {
  // Read-then-write below; without this, two simultaneous first sign-ins
  // (two tabs, or React Strict Mode in development) both see "nothing yet".
  await deps.accounts.lockAccount(input.userId);

  const existingProfile = await deps.accounts.findProfile(input.userId);
  const profile =
    existingProfile ??
    (await deps.accounts.insertProfile({
      userId: input.userId,
      fullName: input.fullName ?? null,
    }));

  const memberships = await deps.accounts.listMemberships(input.userId);
  if (memberships.length > 0) {
    return { profile, memberships };
  }

  const name = input.organizationName ?? FALLBACK_ORGANIZATION_NAME;
  const created = await deps.accounts.insertOrganizationWithOwner({
    userId: input.userId,
    name,
    slug: organizationSlug(name, input.slugSuffix),
  });

  return { profile, memberships: [created] };
}
