# ADR-0008: Supabase Auth with independent JWT verification; non-bypassing runtime DB role

**Status:** Accepted
**Date:** 2026-11-09

## Context

Supabase Auth issues JWTs and handles signup/login/password-reset flows.
Because the Express API is a separate service from Supabase's own
PostgREST layer, the API must verify incoming JWTs itself rather than
assuming Supabase-specific request context exists. Separately, Supabase
provisions a `service_role` database credential that bypasses Row Level
Security by design, for admin tooling — using it anywhere in the
application's normal runtime path would silently defeat every RLS policy
in `docs/SECURITY.md`.

## Decision

- Express verifies every incoming JWT against Supabase's JWKS endpoint,
  extracts the user id (`sub`), and loads that user's organization
  memberships from our own database — it does not rely on Supabase's
  `auth.uid()` (see ADR-0002) or any Supabase-specific request context.
- Two distinct Postgres roles are provisioned: `app_migrator` (owns the
  schema, used only by the migration/deploy pipeline) and `app_runtime`
  (used by the Express API at request time — `NOBYPASSRLS`, not the table
  owner). Every tenant table is `FORCE ROW LEVEL SECURITY`.
- Supabase's `service_role` connection string is never used as the
  Express API's `DATABASE_URL`, enforced by a startup assertion that
  rejects any connected role with `rolbypassrls = true`.

## Alternatives Considered

- **Clerk** was considered as an alternative to Supabase Auth — it has
  first-class "Organizations"/"Roles" primitives matching this project's
  model closely, but adds a second vendor on top of Supabase (DB +
  Storage) and has per-MAU pricing that gets expensive at scale. Worth
  revisiting if auth/org UX becomes a real bottleneck.

## Consequences

- A missing or misconfigured JWKS check is a critical security bug, not
  a cosmetic one — must be covered by an explicit integration test
  (invalid/expired/tampered JWT → rejected).
- The startup assertion against `rolbypassrls` is a cheap, high-value
  safety net against a misconfigured `DATABASE_URL` in any environment.
