import { Router } from 'express';
import { listMembersResponseSchema } from '@psych/types';
import { buildOrganizationsModule } from '../../../../composition/container';
import { withTenantContext } from '../../../../shared/db/tenant-context';
import { PERMISSIONS } from '../../../../shared/authorization/permissions';
import { requireAuth } from '../../../../shared/middleware/require-auth';
import { resolveOrganization } from '../../../../shared/middleware/resolve-organization';
import { requireRole } from '../../../../shared/middleware/require-role';
import { asyncHandler } from '../../../../shared/http/async-handler';
import { tenantContext } from '../../../../shared/http/request-context';

export const membersRouter = Router();

// Any member may see who else works in the practice (names and roles only --
// no emails): the calendar needs it to show and pick professionals.
membersRouter.get(
  '/organizations/current/members',
  requireAuth,
  resolveOrganization,
  requireRole(PERMISSIONS['organization.read']),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const members = await withTenantContext({ userId, organizationId }, (tx) =>
      buildOrganizationsModule(tx).listMembers({ organizationId }),
    );
    res.json(listMembersResponseSchema.parse({ members }));
  }),
);
