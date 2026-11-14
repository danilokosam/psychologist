import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { exportJWK, generateKeyPair } from 'jose';
import type { TestProject } from 'vitest/node';

/**
 * Builds a fresh, production-shaped database for the integration suite and a
 * stand-in for Supabase's JWKS endpoint.
 *
 * Database: drops and recreates `psych_test` on the throwaway container from
 * docker-compose.test.yml, then applies exactly what the real project has --
 * the app_private helpers, every Prisma migration (run as app_migrator), and
 * the app_migrator/app_runtime roles. The API under test connects as
 * app_runtime, so RLS applies exactly as it does in production.
 *
 * Deliberately NOT applied: profiles-auth-fk.sql. There is no `auth.users`
 * here; test users are just UUIDs. That FK is a referential-integrity link to
 * Supabase Auth, not a tenant-isolation control, so nothing under test
 * depends on it.
 *
 * Tokens: an ES256 key pair is generated per run and its public half is
 * served at `<SUPABASE_URL>/auth/v1/.well-known/jwks.json`. requireAuth is
 * not modified or mocked in any way -- it fetches and verifies against this
 * endpoint exactly as it would against Supabase.
 */

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54329/postgres';
const TEST_DB = 'psych_test';

const repoRoot = path.resolve(__dirname, '../../../..');
const dbPackage = path.join(repoRoot, 'packages/db');
const prismaBin = path.join(dbPackage, 'node_modules/.bin/prisma');

function withDatabase(url: string, database: string, user?: string, password?: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  if (user) parsed.username = user;
  if (password) parsed.password = password;
  return parsed.toString();
}

function sql(url: string, script: string) {
  execFileSync(prismaBin, ['db', 'execute', '--url', url, '--stdin'], {
    cwd: dbPackage,
    input: script,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function sqlFile(url: string, file: string) {
  execFileSync(prismaBin, ['db', 'execute', '--url', url, '--file', file], {
    cwd: dbPackage,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function prepareDatabase() {
  const testAdminUrl = withDatabase(ADMIN_URL, TEST_DB);

  sqlFile(ADMIN_URL, path.join(dbPackage, 'sql/local-test-roles.sql'));
  // Separate executions: DROP/CREATE DATABASE cannot run inside the implicit
  // transaction a multi-statement script gets.
  sql(ADMIN_URL, `DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE);`);
  sql(ADMIN_URL, `CREATE DATABASE ${TEST_DB};`);
  // Postgres 15+ no longer lets every role create in `public`; Supabase grants
  // app_migrator this, so mirror it.
  sql(
    testAdminUrl,
    `GRANT USAGE, CREATE ON SCHEMA public TO app_migrator;
     GRANT USAGE ON SCHEMA public TO app_runtime;`,
  );

  // Same order a from-scratch rebuild of the real project uses.
  sqlFile(testAdminUrl, path.join(dbPackage, 'sql/rls-helpers.sql'));
  execFileSync(prismaBin, ['migrate', 'deploy'], {
    cwd: dbPackage,
    env: {
      ...process.env,
      DATABASE_URL: withDatabase(ADMIN_URL, TEST_DB, 'app_migrator', 'app_migrator'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function describeFailure(error: unknown): string {
  const stderr = (error as { stderr?: Buffer }).stderr?.toString();
  return stderr || String(error);
}

let server: Server | undefined;

export default async function setup(project: TestProject) {
  const provide = project.provide.bind(project);
  try {
    prepareDatabase();
  } catch (error) {
    throw new Error(
      'Could not prepare the integration-test database. Is the container running?\n' +
        '  pnpm db:test:up\n\n' +
        describeFailure(error),
    );
  }

  const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true });
  const publicJwk = { ...(await exportJWK(publicKey)), kid: 'integration-test', alg: 'ES256', use: 'sig' };
  const privateJwk = { ...(await exportJWK(privateKey)), kid: 'integration-test', alg: 'ES256' };

  server = createServer((req, res) => {
    if (req.url === '/auth/v1/.well-known/jwks.json') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ keys: [publicJwk] }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('JWKS server has no port');

  provide('supabaseUrl', `http://127.0.0.1:${address.port}`);
  provide('privateJwk', JSON.stringify(privateJwk));
  provide('runtimeDatabaseUrl', withDatabase(ADMIN_URL, TEST_DB, 'app_runtime', 'app_runtime'));
  provide('adminDatabaseUrl', withDatabase(ADMIN_URL, TEST_DB));

  return async () => {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    supabaseUrl: string;
    privateJwk: string;
    runtimeDatabaseUrl: string;
    adminDatabaseUrl: string;
  }
}
