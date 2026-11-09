# ADR-0012: Tenant policies gate on verified membership, via private SECURITY DEFINER helpers

**Status:** Accepted
**Date:** 2026-11-09
**Amends:** the policy pattern sketched in [ADR-0003](0003-defense-in-depth-tenant-isolation.md) (the principle there is unchanged; the SQL that implements it is corrected)

## Context

`docs/SECURITY.md` originally prescribed this shape for every tenant-owned
table:

```sql
USING (organization_id = current_setting('app.current_org_id', true)::uuid)
```

Implementing Milestone 0's account bootstrap and then testing it exposed
three separate problems with that shape. All three were found by running
code, not by review.

**1. It trusts a value the application supplies.** `app.current_org_id`
comes from the caller's `X-Organization-Id` header, validated by the
`resolveOrganization` middleware. So a policy written against it re-checks
the application's own conclusion rather than deriving permission
independently — exactly what ADR-0003 says RLS must not do. The RLS-only
test (`packages/db/scripts/verify-rls-isolation.mjs`) confirmed it: with
only that condition, a caller who set the variable to someone else's
organization could enumerate its `memberships` rows. The full request path
was safe; RLS on its own was not.

**2. `current_setting(name, true)` returns `''`, not NULL, on a reused
connection.** After a transaction has called
`set_config('app.current_org_id', ..., true)`, the GUC stays
defined-but-empty on that backend. A later transaction on the same pooled
connection reads `''`, and `''::uuid` raises 22P02. Through a transaction-mode
pooler this is an intermittent failure that only appears once a connection
has already served an org-scoped request — the first user to sign up worked,
the second did not.

**3. A policy cannot query its own table.** The obvious fix for (1) —
`EXISTS (SELECT 1 FROM memberships ...)` inside a `memberships` policy —
makes Postgres reject the plan with 42P17 "infinite recursion detected in
policy". The same cycle appears between `memberships` and `organizations`
whenever both reference each other.

## Decision

Policies read identity and derive permission through helper functions in a
dedicated **private** schema, `app_private` (created and owned via the
privileged connection, per [ADR-0011](0011-profiles-auth-fk-via-privileged-connection.md)):

- `app_private.current_user_id()` / `current_org_id()` — plain `STABLE`
  readers wrapping the session variable in `nullif(..., '')` so an unset or
  emptied variable reads as NULL and policies fail closed instead of raising
  22P02. Not `SECURITY DEFINER`: they only read session state.
- `app_private.is_active_member(org_id)` and
  `app_private.is_organization_creator(org_id)` — `SECURITY DEFINER`, so the
  lookup runs outside RLS and the recursion in (3) never forms.

Both definer functions are constrained: private schema (unreachable through
the Data API), `EXECUTE` revoked from `PUBLIC` and granted only to
`app_runtime`/`app_migrator`, `SET search_path = ''` with fully-qualified
references, no identity parameter (they read the caller's identity from the
session themselves, so they cannot be asked about another user), and they
return a boolean rather than row data.

**The pattern for every future tenant-owned table** is both conditions, not
either one:

```sql
USING (
  organization_id = (select app_private.current_org_id())   -- the scope the app declared
  AND app_private.is_active_member(organization_id)          -- permission the DB verified itself
)
```

The first condition keeps the application from reading an organization it
didn't ask for; the second is the independent check that still holds if the
application layer has a bug. Calls stay wrapped in `(select ...)` so Postgres
evaluates them once per query rather than per row.

## Alternatives Considered

- **Keep gating on the declared organization alone:** rejected — it is not an
  independent check, which is the entire purpose of the second layer.
- **Reference `memberships` directly from the policies:** rejected — 42P17.
- **Drop `FORCE ROW LEVEL SECURITY` so a definer function owned by
  `app_migrator` would bypass RLS naturally:** rejected. `FORCE` is what makes
  RLS apply to the table owner too, and weakening a documented guarantee to
  avoid one helper function is the wrong trade. The function is instead owned
  by `postgres`, which has `rolbypassrls = true`.
- **A single definer function performing the whole org-creation write:**
  rejected as more machinery than the problem needs, and it would still have
  required INSERT policies.

## Consequences

- Three RLS helper functions are infrastructure that lives outside Prisma
  migrations, in `packages/db/sql/rls-helpers.sql`. Re-running that file is
  idempotent (`CREATE OR REPLACE`).
- `docs/SECURITY.md`'s planned patterns for `patients`, `clinical_sessions`,
  `clinical_notes` and friends must use the two-condition shape above. The
  role-aware clinical policies already re-derive roles from `memberships`, so
  they additionally need `is_active_member`-style treatment rather than a bare
  `current_org_id` comparison.
- `supabase db advisors` reports no security findings for these functions,
  confirming they are not reachable by `anon`/`authenticated`.
- The RLS-only test script is now the thing that proves this holds, and it
  caught a real hole once already. It must be re-run whenever a tenant policy
  changes.
