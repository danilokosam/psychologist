import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { withUserContext } from '../db/tenant-context';
import { authContext } from '../http/request-context';
import { AppError } from './error-handler';

const organizationIdSchema = z.string().uuid();

/**
 * Resolves the active organization from the `X-Organization-Id` header and
 * verifies the caller actually has an active membership in it.
 *
 * This is the application-layer half of tenant isolation -- the first of the
 * two independent checks in ADR-0003. A caller who asks for an organization
 * they don't belong to gets a 404, not a 403: a 403 would confirm that the
 * organization exists.
 *
 * The lookup itself runs under withUserContext, so even this query is subject
 * to RLS: the `memberships_select` policy only exposes rows whose `user_id`
 * matches the verified caller when no organization is in context yet.
 */
export async function resolveOrganization(req: Request, _res: Response, next: NextFunction) {
  try {
    const { userId } = authContext(req);

    const parsed = organizationIdSchema.safeParse(req.header('x-organization-id'));
    if (!parsed.success) {
      throw new AppError(400, 'Missing or malformed X-Organization-Id header', 'BAD_REQUEST');
    }
    const organizationId = parsed.data;

    const membership = await withUserContext({ userId }, (tx) =>
      tx.membership.findFirst({
        where: { organizationId, userId, status: 'active' },
        select: { role: true },
      }),
    );

    if (!membership) {
      throw new AppError(404, 'Organization not found', 'NOT_FOUND');
    }

    req.tenant = { organizationId, role: membership.role };
    next();
  } catch (error) {
    next(error);
  }
}
