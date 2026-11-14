import type { InvitableRole, InvitationStatus } from '@psych/types';
import type { Tx } from '../../../shared/db/tenant-context';
import type { Invitation } from '../domain/invitation';
import type { InvitationRepository } from '../application/ports/invitation-repository';

type InvitationRow = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  status: InvitationStatus;
  expiresAt: Date;
  createdAt: Date;
};

const INVITATION_SELECT = {
  id: true,
  organizationId: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
} as const;

/**
 * Prisma-backed InvitationRepository. Runs on the request's RLS transaction;
 * the invitations policies and column grants (see the migration) are the
 * independent second check on everything here.
 *
 * Updates use `updateMany` with the expected current status in the WHERE
 * clause, so a concurrent revoke/accept can't be silently overwritten -- the
 * second writer simply matches zero rows.
 */
export class PrismaInvitationRepository implements InvitationRepository {
  constructor(private readonly tx: Tx) {}

  async findPendingByEmail(organizationId: string, email: string): Promise<Invitation | null> {
    const row = await this.tx.invitation.findFirst({
      where: { organizationId, email, status: 'pending' },
      select: INVITATION_SELECT,
    });
    return row ? toInvitation(row) : null;
  }

  async insert(record: {
    organizationId: string;
    email: string;
    role: InvitableRole;
    tokenHash: string;
    invitedBy: string;
    expiresAt: Date;
  }): Promise<Invitation> {
    const row = await this.tx.invitation.create({
      // Explicit allow-list -- never a spread of request data.
      data: {
        organizationId: record.organizationId,
        email: record.email,
        role: record.role,
        tokenHash: record.tokenHash,
        invitedBy: record.invitedBy,
        expiresAt: record.expiresAt,
        status: 'pending',
      },
      select: INVITATION_SELECT,
    });
    return toInvitation(row);
  }

  async listPending(organizationId: string): Promise<Invitation[]> {
    const rows = await this.tx.invitation.findMany({
      where: { organizationId, status: 'pending' },
      select: INVITATION_SELECT,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toInvitation);
  }

  async revoke(input: { organizationId: string; invitationId: string; now: Date }): Promise<boolean> {
    const { count } = await this.tx.invitation.updateMany({
      where: { id: input.invitationId, organizationId: input.organizationId, status: 'pending' },
      data: { status: 'revoked', revokedAt: input.now },
    });
    return count === 1;
  }

  async findByTokenHash(tokenHash: string): Promise<Invitation | null> {
    const row = await this.tx.invitation.findUnique({
      where: { tokenHash },
      select: INVITATION_SELECT,
    });
    return row ? toInvitation(row) : null;
  }

  async addMember(input: { organizationId: string; userId: string; role: InvitableRole }): Promise<void> {
    await this.tx.membership.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        role: input.role,
        status: 'active',
      },
      select: { id: true },
    });
  }

  async markAccepted(input: { invitationId: string; userId: string; now: Date }): Promise<void> {
    const { count } = await this.tx.invitation.updateMany({
      where: { id: input.invitationId, status: 'pending' },
      data: { status: 'accepted', acceptedBy: input.userId, acceptedAt: input.now },
    });
    if (count !== 1) {
      // Lost a race with a concurrent revoke/accept. Throwing rolls back the
      // membership inserted just before, in the same transaction.
      throw new Error('Invitation was no longer pending when accepted');
    }
  }
}

function toInvitation(row: InvitationRow): Invitation {
  if (row.role !== 'psychologist' && row.role !== 'admin_staff') {
    // Unreachable while the invitations_role_not_owner CHECK holds.
    throw new Error(`Unexpected invitation role: ${row.role}`);
  }
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
