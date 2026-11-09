# ADR-0003: Defense-in-depth tenant isolation with identity-only session variables

**Status:** Accepted
**Date:** 2026-11-09

## Context

Tenant isolation (organization boundaries, and additionally role
restrictions on clinical notes) must not depend on a single layer. An
earlier draft of this architecture set a session variable for the user's
*role* and trusted it in RLS policies — but if the application code that
computed that role has a bug, the RLS policy built on top of it shares the
exact same bug. That is not independent defense in depth, it's one
decision duplicated into two places.

## Decision

1. Application-level authorization (middleware: membership check, role
   check) runs on every request, independent of the database.
2. Database-level RLS policies run on every query, independent of the
   application code, and are the fallback if (1) has a bug.
3. To keep these genuinely independent, **session variables carry only
   verified identity** (`app.current_user_id`, `app.current_org_id`),
   never an authorization conclusion. Sensitive RLS policies (e.g. on
   `clinical_notes`) re-derive the role fresh, inside the policy, via a
   subquery against `memberships` — they do not trust a role the session
   claims to have.

Full SQL patterns: `docs/SECURITY.md`.

## Alternatives Considered

- **RLS trusts an app-supplied role session variable:** simpler, but not
  actually independent — rejected for exactly the reason above.
- **RLS only (no app-layer check):** confusing failure mode (silent empty
  results instead of a clear 403/404) and no opportunity for
  user-friendly error handling or audit logging before hitting the DB.
- **App-layer only (no RLS):** fragile to a single missed `WHERE`
  clause — the scenario this ADR exists to prevent.

## Consequences

- Both layers must be tested: cross-tenant integration tests that go
  through the full stack, **and** a test that deliberately removes the
  app-layer filter to confirm RLS alone still blocks access.
- Slightly more SQL complexity in sensitive policies (a subquery against
  `memberships`), justified by the security property gained.
