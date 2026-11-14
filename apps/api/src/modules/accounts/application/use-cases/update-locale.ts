import type { SupportedLocale } from '@psych/types';
import type { Account } from '../../domain/account';
import type { AccountRepository } from '../ports/account-repository';

/**
 * Persists the caller's UI language (F-013) so it follows them to any device.
 * Only ever the caller's own profile: `userId` is the verified token subject,
 * and the profiles_self_update RLS policy rejects any other row regardless.
 */
export async function updateLocale(
  input: { userId: string; locale: SupportedLocale },
  deps: { accounts: AccountRepository },
): Promise<Account | null> {
  const profile = await deps.accounts.updateLocale(input);
  if (!profile) {
    return null;
  }
  return { profile, memberships: await deps.accounts.listMemberships(input.userId) };
}
