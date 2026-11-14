import type { InvitableRole } from '@psych/types';
import type { Invitation } from '../../domain/invitation';

/**
 * Persistence the invitation use cases need. Every method runs inside the
 * caller's RLS transaction, so even a bug here cannot reach another
 * organization's invitations (ADR-0003).
 */
export interface InvitationRepository {
  findPendingByEmail(organizationId: string, email: string): Promise<Invitation | null>;

  insert(record: {
    organizationId: string;
    email: string;
    role: InvitableRole;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
  }): Promise<Invitation>;

  listPending(organizationId: string): Promise<Invitation[]>;

  /** Revokes a still-pending invitation. Returns false if there was none to revoke. */
  revoke(input: { organizationId: string; invitationId: string; now: Date }): Promise<boolean>;

  findByTokenHash(tokenHash: string): Promise<Invitation | null>;

  addMember(input: { organizationId: string; userId: string; role: InvitableRole }): Promise<void>;

  markAccepted(input: { invitationId: string; userId: string; now: Date }): Promise<void>;
}

/** Link-token generation and hashing, kept behind a port so use cases stay deterministic in tests. */
export interface InvitationTokens {
  generate(): { token: string; tokenHash: string };
  hash(token: string): string;
}
