// Read-only verification that tenant isolation holds at the DATABASE layer,
// independent of any application code: no Express, no middleware, no
// authorization checks in front of it. It connects with DATABASE_URL (the
// app_runtime role), sets only the identity session variables, and asserts
// that one user cannot see another user's organization.
//
// This is the "RLS-only" half of the two-layer test strategy in
// docs/SECURITY.md: the full-stack half lives in the API's own test suite.
// It is NOT part of `pnpm test` because it needs real credentials and a live
// database -- run it manually:
//
//   node --env-file=.env scripts/verify-rls-isolation.mjs <userA> <userB> <orgOfA>
//
// Exits non-zero if isolation is violated.

import { PrismaClient } from '../generated/client/index.js';

const [userA, userB, orgOfA] = process.argv.slice(2);
if (!userA || !userB || !orgOfA) {
  console.error('usage: verify-rls-isolation.mjs <userA> <userB> <orgOfA>');
  process.exit(2);
}

const prisma = new PrismaClient();
const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` -- ${detail}` : ''}`);
}

/** Mirrors withUserContext: identity only, no organization in scope. */
async function asUser(userId, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    return fn(tx);
  });
}

/** Mirrors withTenantContext: identity plus a claimed organization. */
async function asUserInOrg(userId, organizationId, fn) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.current_user_id', ${userId}, true)`;
    await tx.$executeRaw`SELECT set_config('app.current_org_id', ${organizationId}, true)`;
    return fn(tx);
  });
}

try {
  const ownerSees = await asUser(userA, (tx) =>
    tx.organization.findUnique({ where: { id: orgOfA }, select: { id: true } }),
  );
  check('owner can read their own organization', ownerSees?.id === orgOfA);

  // The core cross-tenant assertion: B asks for A's organization by id, with
  // nothing standing in the way except RLS.
  const strangerSees = await asUser(userB, (tx) =>
    tx.organization.findUnique({ where: { id: orgOfA }, select: { id: true } }),
  );
  check('stranger cannot read another user organization', strangerSees === null);

  // The nastier variant: B *claims* A's organization as their active context,
  // exactly as a buggy or malicious caller would. RLS must still refuse,
  // because membership -- not the claim -- is what the policy checks.
  const strangerClaiming = await asUserInOrg(userB, orgOfA, (tx) =>
    tx.organization.findUnique({ where: { id: orgOfA }, select: { id: true } }),
  );
  check('claiming another organization as active context changes nothing', strangerClaiming === null);

  const strangerMemberships = await asUserInOrg(userB, orgOfA, (tx) =>
    tx.membership.findMany({ where: { organizationId: orgOfA }, select: { id: true } }),
  );
  check(
    'stranger cannot enumerate another organization memberships',
    strangerMemberships.length === 0,
    `${strangerMemberships.length} rows`,
  );

  const strangerProfiles = await asUser(userB, (tx) =>
    tx.profile.findUnique({ where: { id: userA }, select: { id: true } }),
  );
  check('stranger cannot read an unrelated user profile', strangerProfiles === null);

  // Writes must fail closed too: B tries to insert themselves into A's org.
  let insertRejected = false;
  try {
    await asUser(userB, (tx) =>
      tx.membership.create({
        data: { organizationId: orgOfA, userId: userB, role: 'owner', status: 'active' },
        select: { id: true },
      }),
    );
  } catch {
    insertRejected = true;
  }
  check('stranger cannot grant themselves membership in another organization', insertRejected);
} finally {
  await prisma.$disconnect();
}

const failed = results.filter((r) => !r.passed);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
