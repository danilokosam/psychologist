import type { InvitableRole, InvitationStatus } from '@psych/types';

// Hand-written domain type; the Prisma adapter maps rows onto it (ADR-0009).
export type Invitation = {
  id: string;
  organizationId: string;
  email: string;
  role: InvitableRole;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
};

/**
 * Long enough for someone to act on a link shared over a weekend, short enough
 * that a forgotten link stops being a standing way into the organization.
 */
export const INVITATION_TTL_DAYS = 7;

export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function isExpired(invitation: Pick<Invitation, 'expiresAt'>, now: Date): boolean {
  return invitation.expiresAt.getTime() <= now.getTime();
}

/**
 * The application-layer acceptance rule (ADR-0013): still pending, not
 * expired, and addressed to the caller's verified email. RLS enforces the
 * same conditions independently; this check is what produces the clean 404
 * rather than relying on the database alone.
 */
export function canBeAcceptedBy(
  invitation: Invitation,
  caller: { email: string },
  now: Date,
): boolean {
  return (
    invitation.status === 'pending' &&
    !isExpired(invitation, now) &&
    invitation.email === caller.email.trim().toLowerCase()
  );
}
