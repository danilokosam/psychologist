import type { InvitableRole } from '@psych/types';
import { invitationExpiry, isExpired, type Invitation } from '../../domain/invitation';
import type { InvitationRepository, InvitationTokens } from '../ports/invitation-repository';

export type CreateInvitationResult =
  | { kind: 'created'; invitation: Invitation; token: string }
  | { kind: 'duplicate' };

/**
 * An owner invites an email address into their organization (ADR-0013).
 *
 * `organizationId` and `invitedBy` come from the verified tenant context,
 * never the request body. The plaintext token is returned to the caller
 * exactly once and never stored.
 */
export async function createInvitation(
  input: {
    organizationId: string;
    invitedBy: string;
    email: string;
    role: InvitableRole;
    now: Date;
  },
  deps: { invitations: InvitationRepository; tokens: InvitationTokens },
): Promise<CreateInvitationResult> {
  const email = input.email.trim().toLowerCase();

  const existing = await deps.invitations.findPendingByEmail(input.organizationId, email);
  if (existing) {
    if (!isExpired(existing, input.now)) {
      return { kind: 'duplicate' };
    }
    // An expired invitation still occupies the one-pending-per-email slot;
    // retire it so the owner can simply invite again.
    await deps.invitations.revoke({
      organizationId: input.organizationId,
      invitationId: existing.id,
      now: input.now,
    });
  }

  const { token, tokenHash } = deps.tokens.generate();
  const invitation = await deps.invitations.insert({
    organizationId: input.organizationId,
    email,
    role: input.role,
    tokenHash,
    invitedBy: input.invitedBy,
    expiresAt: invitationExpiry(input.now),
  });

  return { kind: 'created', invitation, token };
}
