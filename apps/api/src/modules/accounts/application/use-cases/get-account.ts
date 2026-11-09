import type { Account } from '../../domain/account';
import type { AccountRepository } from '../ports/account-repository';

/**
 * Returns the caller's profile and the organizations they belong to -- the
 * data the frontend needs to render a shell and offer an organization to work
 * in. Returns null when the account hasn't been bootstrapped yet.
 */
export async function getAccount(
  input: { userId: string },
  deps: { accounts: AccountRepository },
): Promise<Account | null> {
  const profile = await deps.accounts.findProfile(input.userId);
  if (!profile) {
    return null;
  }

  const memberships = await deps.accounts.listMemberships(input.userId);
  return { profile, memberships };
}
