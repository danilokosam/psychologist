import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { assertNoBypassRls } from '../../src/shared/db/assert-no-bypass-rls';
import { prisma } from '../../src/shared/db/prisma';
import { adminDb, makeUser, resetDatabase, runtimeDb, signToken } from './helpers';

// Proves the harness itself is trustworthy before anything relies on it: if
// the API were connected as a role that bypasses RLS, every isolation test in
// this suite would pass vacuously.
describe('integration harness', () => {
  const app = createApp();

  beforeAll(resetDatabase);
  afterAll(async () => {
    await Promise.all([prisma.$disconnect(), adminDb.$disconnect(), runtimeDb.$disconnect()]);
  });

  it('the API connects as a role that cannot bypass RLS', async () => {
    const logSpy = console.log;
    console.log = () => {};
    try {
      await expect(assertNoBypassRls()).resolves.toBeUndefined();
    } finally {
      console.log = logSpy;
    }
    const [row] = await prisma.$queryRaw<{ current_user: string }[]>`SELECT current_user`;
    expect(row?.current_user).toBe('app_runtime');
  });

  it('every tenant table has RLS enabled AND forced', async () => {
    const rows = await adminDb.$queryRaw<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
    `;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row, row.relname).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
    }
  });

  it('a locally signed token passes the real requireAuth and bootstraps through RLS', async () => {
    const user = await makeUser('harness');

    const response = await request(app)
      .post('/auth/bootstrap')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ fullName: 'Synthetic Tester', organizationName: 'Harness Practice' });

    expect(response.status).toBe(200);
    expect(response.body.memberships).toHaveLength(1);
    expect(response.body.memberships[0].role).toBe('owner');
  });

  it('concurrent bootstraps for the same new user are safe (one profile, one practice)', async () => {
    // Found in the browser: React Strict Mode (and two open tabs) fire
    // POST /auth/bootstrap twice at once for a brand-new user.
    const user = await makeUser('concurrent');

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(app)
          .post('/auth/bootstrap')
          .set('Authorization', `Bearer ${user.token}`)
          .send({ organizationName: 'Race Practice' }),
      ),
    );

    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(await adminDb.profile.count({ where: { id: user.id } })).toBe(1);
    expect(await adminDb.organization.count({ where: { createdBy: user.id } })).toBe(1);
    expect(await adminDb.membership.count({ where: { userId: user.id } })).toBe(1);
  });

  it('a token from another issuer is rejected', async () => {
    const user = await makeUser('wrong-issuer');
    const token = await signToken(
      { sub: user.id, email: user.email },
      { issuer: 'https://evil.example/auth/v1' },
    );

    const response = await request(app).get('/me').set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });
});
