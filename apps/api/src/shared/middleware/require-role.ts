import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { MembershipRole } from '@psych/types';
import { tenantContext } from '../http/request-context';
import { AppError } from './error-handler';

/**
 * Rejects a request whose caller lacks one of the `allowed` roles in the
 * active organization. Use with an entry from PERMISSIONS rather than an
 * ad-hoc list: `requireRole(PERMISSIONS['patients.delete'])`.
 *
 * Must run after requireAuth and resolveOrganization. The role it reads was
 * loaded from `memberships` by resolveOrganization -- never from a header,
 * token claim or body -- and it decides before any query for the resource is
 * built. It is the first authorization gate; RLS is the independent second
 * one and re-derives the role from `memberships` itself (ADR-0003).
 *
 * Responds 403, not 404: by this point the caller is a verified member of the
 * organization, and because the check runs before any lookup it reveals
 * nothing about whether a particular resource exists. The 404-not-403 rule is
 * for callers who are *not* members (resolveOrganization handles that).
 */
export function requireRole(allowed: readonly MembershipRole[]): RequestHandler {
  // Fail at startup, not per request: an empty list would deny everyone and
  // is always a programming mistake.
  if (allowed.length === 0) {
    throw new Error('requireRole needs at least one allowed role');
  }
  const allowedRoles = new Set<MembershipRole>(allowed);

  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const { role } = tenantContext(req);
      if (!allowedRoles.has(role)) {
        next(new AppError(403, 'Your role does not permit this action', 'FORBIDDEN'));
        return;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}
