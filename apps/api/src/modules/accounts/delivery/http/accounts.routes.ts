import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  accountResponseSchema,
  bootstrapAccountRequestSchema,
  updateProfileRequestSchema,
} from '@psych/types';
import { buildAccountsModule } from '../../../../composition/container';
import { withTenantContext, withUserContext } from '../../../../shared/db/tenant-context';
import { requireAuth } from '../../../../shared/middleware/require-auth';
import { resolveOrganization } from '../../../../shared/middleware/resolve-organization';
import { requireRole } from '../../../../shared/middleware/require-role';
import { PERMISSIONS } from '../../../../shared/authorization/permissions';
import { AppError } from '../../../../shared/middleware/error-handler';
import { asyncHandler } from '../../../../shared/http/async-handler';
import { authContext, tenantContext } from '../../../../shared/http/request-context';

export const accountsRouter = Router();

/**
 * Idempotently prepares the signed-in user for use: creates their profile
 * row and, on first call, their own solo-practice organization with an
 * `owner` membership. Safe to call on every sign-in.
 *
 * Runs under withUserContext (user identity only, no organization yet) --
 * which is precisely the case that context exists for.
 */
accountsRouter.post(
  '/auth/bootstrap',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);

    const body = bootstrapAccountRequestSchema.safeParse(req.body ?? {});
    if (!body.success) {
      throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    }

    const account = await withUserContext({ userId }, (tx) =>
      buildAccountsModule(tx).bootstrapAccount({
        userId,
        fullName: body.data.fullName,
        organizationName: body.data.organizationName,
        slugSuffix: randomUUID().slice(0, 8),
      }),
    );

    res.status(200).json(accountResponseSchema.parse(account));
  }),
);

/** The caller's profile and the organizations they belong to. */
accountsRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);

    const account = await withUserContext({ userId }, (tx) =>
      buildAccountsModule(tx).getAccount({ userId }),
    );

    if (!account) {
      throw new AppError(404, 'Account has not been bootstrapped', 'NOT_FOUND');
    }

    res.json(accountResponseSchema.parse(account));
  }),
);

/**
 * Updates the caller's own profile preferences -- today only the UI language
 * (F-013). There is deliberately no user id anywhere in the request: the
 * profile updated is always the token subject's.
 */
accountsRouter.patch(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { userId } = authContext(req);

    const body = updateProfileRequestSchema.safeParse(req.body ?? {});
    if (!body.success) {
      throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    }

    const account = await withUserContext({ userId }, (tx) =>
      buildAccountsModule(tx).updateLocale({ userId, locale: body.data.locale }),
    );

    if (!account) {
      throw new AppError(404, 'Account has not been bootstrapped', 'NOT_FOUND');
    }

    res.json(accountResponseSchema.parse(account));
  }),
);

/**
 * The organization named by the X-Organization-Id header.
 *
 * This is the first endpoint that runs under full tenant context, so it's
 * also the end-to-end proof that org-scoped RLS works: the row is fetched
 * with no `WHERE organizationId` filter of its own in the policy path beyond
 * what RLS applies, and a caller without an active membership never gets
 * past resolveOrganization.
 */
accountsRouter.get(
  '/organizations/current',
  requireAuth,
  resolveOrganization,
  requireRole(PERMISSIONS['organization.read']),
  asyncHandler(async (req, res) => {
    const { userId, organizationId, role } = tenantContext(req);

    const organization = await withTenantContext({ userId, organizationId }, (tx) =>
      tx.organization.findUnique({
        where: { id: organizationId },
        select: { id: true, name: true, slug: true },
      }),
    );

    if (!organization) {
      throw new AppError(404, 'Organization not found', 'NOT_FOUND');
    }

    res.json({ organization, role });
  }),
);
