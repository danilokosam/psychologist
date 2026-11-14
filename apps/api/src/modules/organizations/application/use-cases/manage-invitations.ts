import type { Invitation } from '../../domain/invitation';
import type { InvitationRepository } from '../ports/invitation-repository';

/** Pending invitations of the caller's organization (owner-only at the route). */
export function listInvitations(
  input: { organizationId: string },
  deps: { invitations: InvitationRepository },
): Promise<Invitation[]> {
  return deps.invitations.listPending(input.organizationId);
}

/**
 * Withdraws a pending invitation. A status change, never a delete, so the
 * record of who offered access to whom survives (ADR-0013).
 */
export function revokeInvitation(
  input: { organizationId: string; invitationId: string; now: Date },
  deps: { invitations: InvitationRepository },
): Promise<boolean> {
  return deps.invitations.revoke(input);
}
