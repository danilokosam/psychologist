import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { MembershipRole } from '@psych/types';
import { PERMISSIONS, type Permission } from '../authorization/permissions';
import { errorHandler } from './error-handler';
import { requireRole } from './require-role';

const ROLES: MembershipRole[] = ['owner', 'psychologist', 'admin_staff'];

// Transcribed by hand from the "Role permission matrix" table in
// docs/SECURITY.md -- deliberately NOT derived from PERMISSIONS. If someone
// edits the code matrix without updating the documented one (or vice versa),
// this table disagrees with one of them and the suite fails.
const EXPECTED: Record<Permission, Record<MembershipRole, boolean>> = {
  'organization.read': { owner: true, psychologist: true, admin_staff: true },
  'organization.manage': { owner: true, psychologist: false, admin_staff: false },
  'patients.read': { owner: true, psychologist: true, admin_staff: true },
  'patients.write': { owner: true, psychologist: true, admin_staff: true },
  'patients.delete': { owner: true, psychologist: false, admin_staff: false },
  'appointments.read': { owner: true, psychologist: true, admin_staff: true },
  'appointments.write': { owner: true, psychologist: true, admin_staff: true },
  'clinicalSessions.read': { owner: true, psychologist: true, admin_staff: true },
  'clinicalSessions.write': { owner: true, psychologist: true, admin_staff: false },
  'clinicalNotes.read': { owner: true, psychologist: true, admin_staff: false },
  'clinicalNotes.write': { owner: true, psychologist: true, admin_staff: false },
  'payments.read': { owner: true, psychologist: true, admin_staff: true },
  'payments.write': { owner: true, psychologist: true, admin_staff: true },
  'payments.refund': { owner: true, psychologist: false, admin_staff: false },
};

/**
 * Stands in for requireAuth + resolveOrganization: attaches a verified
 * identity and the role the test asks for. In production that role comes from
 * the `memberships` row, never from a header -- this header exists only here.
 */
function fakeTenant(req: Request, _res: Response, next: NextFunction) {
  req.auth = { userId: '11111111-1111-4111-8111-111111111111' };
  req.tenant = {
    organizationId: '22222222-2222-4222-8222-222222222222',
    role: req.header('x-test-role') as MembershipRole,
  };
  next();
}

function appGuardedBy(permission: Permission, handler = vi.fn()) {
  const app = express();
  app.get(
    '/resource',
    fakeTenant,
    requireRole(PERMISSIONS[permission]),
    (req: Request, res: Response) => {
      handler();
      res.json({ ok: true });
    },
  );
  app.use(errorHandler);
  return { app, handler };
}

describe('requireRole', () => {
  it('the code matrix covers exactly the documented actions', () => {
    expect(Object.keys(PERMISSIONS).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  describe.each(Object.keys(EXPECTED) as Permission[])('%s', (permission) => {
    it.each(ROLES)('%s', async (role) => {
      const { app, handler } = appGuardedBy(permission);

      const response = await request(app).get('/resource').set('x-test-role', role);

      if (EXPECTED[permission][role]) {
        expect(response.status).toBe(200);
        expect(handler).toHaveBeenCalledOnce();
      } else {
        expect(response.status).toBe(403);
        expect(response.body).toEqual({
          error: { code: 'FORBIDDEN', message: 'Your role does not permit this action' },
        });
        // The acceptance criterion: rejected before the handler -- and so
        // before any query for the resource -- ever runs.
        expect(handler).not.toHaveBeenCalled();
      }
    });
  });

  it('admin_staff is denied every clinical-notes action', () => {
    // Called out separately because it is the one rule in the matrix that
    // must never regress (ADR-0010): spelled out, not just implied above.
    expect(PERMISSIONS['clinicalNotes.read']).not.toContain('admin_staff');
    expect(PERMISSIONS['clinicalNotes.write']).not.toContain('admin_staff');
  });

  it('fails loudly when mounted without resolveOrganization', async () => {
    const app = express();
    const handler = vi.fn();
    app.get('/resource', requireRole(['owner']), (_req, res) => {
      handler();
      res.json({ ok: true });
    });
    app.use(errorHandler);

    const response = await request(app).get('/resource');

    // A misconfigured route must not fall through to the handler.
    expect(response.status).toBe(500);
    expect(handler).not.toHaveBeenCalled();
  });

  it('refuses an empty role list at construction time', () => {
    expect(() => requireRole([])).toThrow(/at least one/);
  });
});
