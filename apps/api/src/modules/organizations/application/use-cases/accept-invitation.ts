import type { Account } from '../../../accounts/domain/account';
import type { AccountRepository } from '../../../accounts/application/ports/account-repository';
import { canBeAcceptedBy } from '../../domain/invitation';
import type { InvitationRepository, InvitationTokens } from '../ports/invitation-repository';

export type AcceptInvitationResult =
  | { kind: 'accepted'; organizationId: string; account: Account }
  | { kind: 'not_found' }
  | { kind: 'already_member' };

/**
 * Turns an invitation into an active membership for the caller.
 *
 * Requires both proofs from ADR-0013: possession of the link token, and a
 * verified email equal to the invited address. Every way of failing those --
 * unknown token, wrong email, expired, revoked, already used -- collapses into
 * one `not_found`, so the endpoint can't be used to probe which tokens or
 * addresses exist.
 *
 * Creates the caller's profile if needed, so an invitee who goes straight to
 * the link joins the inviting organization without also getting a solo
 * practice from /auth/bootstrap.
 */
export async function acceptInvitation(
  input: {
    userId: string;
    email: string | undefined;
    token: string;
    fullName?: string | undefined;
    now: Date;
  },
  deps: { invitations: InvitationRepository; accounts: AccountRepository; tokens: InvitationTokens },
): Promise<AcceptInvitationResult> {
  if (!input.email) {
    return { kind: 'not_found' };
  }

  const invitation = await deps.invitations.findByTokenHash(deps.tokens.hash(input.token));
  if (!invitation || !canBeAcceptedBy(invitation, { email: input.email }, input.now)) {
    return { kind: 'not_found' };
  }

  // Same read-then-write race as bootstrap (this may create the profile).
  await deps.accounts.lockAccount(input.userId);
  const profile =
    (await deps.accounts.findProfile(input.userId)) ??
    (await deps.accounts.insertProfile({ userId: input.userId, fullName: input.fullName ?? null }));

  const memberships = await deps.accounts.listMemberships(input.userId);
  if (memberships.some((m) => m.organizationId === invitation.organizationId)) {
    return { kind: 'already_member' };
  }

  // Membership first, then the invitation: the database only allows the
  // membership insert while the invitation is still pending
  // (memberships_insert policy), and both writes share one transaction.
  await deps.invitations.addMember({
    organizationId: invitation.organizationId,
    userId: input.userId,
    role: invitation.role,
  });
  await deps.invitations.markAccepted({
    invitationId: invitation.id,
    userId: input.userId,
    now: input.now,
  });

  return {
    kind: 'accepted',
    organizationId: invitation.organizationId,
    account: { profile, memberships: await deps.accounts.listMemberships(input.userId) },
  };
}
