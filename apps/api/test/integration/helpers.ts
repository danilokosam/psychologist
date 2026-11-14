import { randomUUID } from 'node:crypto';
import { importJWK, SignJWT, type JWK } from 'jose';
import { inject } from 'vitest';
import { PrismaClient } from '@psych/db';

/**
 * PRIVILEGED client (connects as the container's superuser, so RLS does not
 * apply). For fixtures and assertions about what is really in the database --
 * NEVER for the behaviour under test, which must always go through the API
 * (app_runtime) or the RLS-only client below.
 */
export const adminDb = new PrismaClient({ datasourceUrl: inject('adminDatabaseUrl') });

/**
 * Connects as app_runtime with no application code in front of it -- the
 * "RLS-only" layer of docs/SECURITY.md's two-layer test strategy.
 */
export const runtimeDb = new PrismaClient({ datasourceUrl: inject('runtimeDatabaseUrl') });

type Identity = { userId: string; email?: string; organizationId?: string };

/** Mirrors withUserContext/withTenantContext: identity session variables only. */
export function asIdentity<T>(
  identity: Identity,
  fn: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<T>,
): Promise<T> {
  return runtimeDb.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${identity.userId}, true)`;
    if (identity.email) {
      await tx.$executeRaw`SELECT set_config('app.current_user_email', ${identity.email}, true)`;
    }
    if (identity.organizationId) {
      await tx.$executeRaw`SELECT set_config('app.current_org_id', ${identity.organizationId}, true)`;
    }
    return fn(tx);
  });
}

export type TestUser = { id: string; email: string; token: string };

let signingKey: Awaited<ReturnType<typeof importJWK>> | undefined;

/** Signs an access token shaped like Supabase's, with the run's test key. */
export async function signToken(
  claims: { sub: string; email?: string },
  options: { expiresIn?: string | number; issuer?: string } = {},
): Promise<string> {
  signingKey ??= await importJWK(JSON.parse(inject('privateJwk')) as JWK, 'ES256');
  return new SignJWT({ email: claims.email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'ES256', kid: 'integration-test' })
    .setSubject(claims.sub)
    .setIssuer(options.issuer ?? `${inject('supabaseUrl')}/auth/v1`)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '10m')
    .sign(signingKey);
}

/** A synthetic user: a random id plus a token for it. No real person. */
export async function makeUser(label: string): Promise<TestUser> {
  const id = randomUUID();
  const email = `${label}-${id.slice(0, 8)}@example.test`;
  return { id, email, token: await signToken({ sub: id, email }) };
}

/** Wipes all tenant data between test files. Privileged on purpose. */
export async function resetDatabase() {
  await adminDb.$executeRawUnsafe(
    'TRUNCATE TABLE invitations, memberships, organizations, profiles RESTART IDENTITY CASCADE',
  );
}

/** Signs up a synthetic user through the real API and returns their solo practice. */
export async function bootstrapUser(
  app: import('express').Express,
  label: string,
): Promise<TestUser & { organizationId: string }> {
  const user = await makeUser(label);
  const { default: request } = await import('supertest');
  const response = await request(app)
    .post('/auth/bootstrap')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ fullName: `Synthetic ${label}`, organizationName: `${label} practice` });
  if (response.status !== 200) {
    throw new Error(`bootstrap failed for ${label}: ${response.status} ${JSON.stringify(response.body)}`);
  }
  return { ...user, organizationId: response.body.memberships[0].organizationId };
}
