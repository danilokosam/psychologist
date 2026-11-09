import type { Request } from 'express';
import type { MembershipRole } from '@psych/db';
import { AppError } from '../middleware/error-handler';

// Request-scoped context attached by middleware. Declared as optional here
// because it genuinely is absent until the corresponding middleware has run;
// the accessors below turn "absent" into a loud programming error rather than
// letting a handler silently read undefined.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string };
      tenant?: { organizationId: string; role: MembershipRole };
    }
  }
}

/** Identity proven by a verified access token. Requires requireAuth to have run. */
export function authContext(req: Request): { userId: string } {
  if (!req.auth) {
    throw new AppError(500, 'Route is missing the requireAuth middleware');
  }
  return req.auth;
}

/**
 * Verified identity plus the organization the caller has an active membership
 * in. Requires requireAuth and resolveOrganization to have run.
 */
export function tenantContext(req: Request): {
  userId: string;
  organizationId: string;
  role: MembershipRole;
} {
  const auth = authContext(req);
  if (!req.tenant) {
    throw new AppError(500, 'Route is missing the resolveOrganization middleware');
  }
  return { userId: auth.userId, ...req.tenant };
}
