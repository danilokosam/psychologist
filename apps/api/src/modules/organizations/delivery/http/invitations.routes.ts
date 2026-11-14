import { Router } from 'express';
import { z } from 'zod';
import {
  acceptInvitationRequestSchema,
  acceptInvitationResponseSchema,
  createInvitationRequestSchema,
  createInvitationResponseSchema,
  listInvitationsResponseSchema,
} from '@psych/types';
import { buildOrganizationsModule } from '../../../../composition/container';
import { withTenantContext, withUserContext } from '../../../../shared/db/tenant-context';
import { isUniqueViolation } from '../../../../shared/db/errors';
import { PERMISSIONS } from '../../../../shared/authorization/permissions';
import { requireAuth } from '../../../../shared/middleware/require-auth';
import { resolveOrganization } from '../../../../shared/middleware/resolve-organization';
import { requireRole } from '../../../../shared/middleware/require-role';
import { AppError } from '../../../../shared/middleware/error-handler';
import { asyncHandler } from '../../../../shared/http/async-handler';
import { authContext, tenantContext } from '../../../../shared/http/request-context';
import type { Invitation } from '../../domain/invitation';

export const invitationsRouter = Router();

const manageInvitations = [
  requireAuth,
  resolveOrganization,
  requireRole(PERMISSIONS['organization.manage']),
] as const;

function toResponse(invitation: Invitation) {
  return {
    id: invitation.id,
    email: invitation.email,
    role: invitation.role,
    status: invitation.status,
    expiresAt: invitation.expiresAt.toISOString(),
    createdAt: invitation.createdAt.toISOString(),
  };
}

/** Owner invites an email address. Returns the link token exactly once. */
invitationsRouter.post(
  '/organizations/current/invitations',
  ...manageInvitations,
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const body = createInvitationRequestSchema.safeParse(req.body ?? {});
    if (!body.success) {
      throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    }

    let result;
    try {
      result = await withTenantContext({ userId, organizationId }, (tx) =>
        buildOrganizationsModule(tx).createInvitation({
          organizationId,
          invitedBy: userId,
          email: body.data.email,
          role: body.data.role,
          now: new Date(),
        }),
      );
    } catch (error) {
      // A concurrent identical invite lost the race against the partial
      // unique index -- same outcome as the pre-check below.
      if (isUniqueViolation(error)) result = { kind: 'duplicate' as const };
      else throw error;
    }

    if (result.kind === 'duplicate') {
      throw new AppError(409, 'A pending invitation already exists for this email', 'CONFLICT');
    }

    res.status(201).json(
      createInvitationResponseSchema.parse({
        invitation: toResponse(result.invitation),
        token: result.token,
      }),
    );
  }),
);

invitationsRouter.get(
  '/organizations/current/invitations',
  ...manageInvitations,
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const invitations = await withTenantContext({ userId, organizationId }, (tx) =>
      buildOrganizationsModule(tx).listInvitations({ organizationId }),
    );
    res.json(listInvitationsResponseSchema.parse({ invitations: invitations.map(toResponse) }));
  }),
);

invitationsRouter.delete(
  '/organizations/current/invitations/:invitationId',
  ...manageInvitations,
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const invitationId = z.uuid().safeParse(req.params.invitationId);
    // A malformed id is answered exactly like an unknown one.
    if (!invitationId.success) {
      throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
    }

    const revoked = await withTenantContext({ userId, organizationId }, (tx) =>
      buildOrganizationsModule(tx).revokeInvitation({
        organizationId,
        invitationId: invitationId.data,
        now: new Date(),
      }),
    );
    if (!revoked) {
      throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
    }
    res.status(204).end();
  }),
);

/**
 * The invitee accepts. Needs only a verified token -- no X-Organization-Id,
 * because the caller is not a member of anything yet; the organization comes
 * from the invitation itself. Runs under withUserContext with the verified
 * email, which the invitation policies read (ADR-0013).
 */
invitationsRouter.post(
  '/invitations/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId, email } = authContext(req);
    const body = acceptInvitationRequestSchema.safeParse(req.body ?? {});
    // A malformed token is indistinguishable from an unknown one.
    if (!body.success) {
      throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
    }

    let result;
    try {
      result = await withUserContext({ userId, email }, (tx) =>
        buildOrganizationsModule(tx).acceptInvitation({
          userId,
          email,
          token: body.data.token,
          fullName: body.data.fullName,
          now: new Date(),
        }),
      );
    } catch (error) {
      // Two simultaneous accepts by the same user: memberships' unique
      // (organization_id, user_id) is the guarantee; report it as such.
      if (isUniqueViolation(error)) result = { kind: 'already_member' as const };
      else throw error;
    }

    if (result.kind === 'not_found') {
      throw new AppError(404, 'Invitation not found', 'NOT_FOUND');
    }
    if (result.kind === 'already_member') {
      throw new AppError(409, 'You are already a member of this organization', 'CONFLICT');
    }

    res.json(
      acceptInvitationResponseSchema.parse({
        organizationId: result.organizationId,
        account: result.account,
      }),
    );
  }),
);
