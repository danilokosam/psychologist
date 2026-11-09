# ADR-0002: Prisma ORM with manually propagated RLS session context

**Status:** Accepted
**Date:** 2026-11-09

## Context

PostgreSQL Row Level Security policies need to know, per query, which
organization and user are asking. Supabase's `auth.uid()` only resolves
when a query passes through Supabase's PostgREST layer, which forwards the
caller's JWT into the Postgres session. Prisma connects directly to
Postgres over its own pooled connection and never passes through
PostgREST, so **`auth.uid()` is not populated for Prisma queries** — any
policy written against it would silently return zero rows.

We evaluated Drizzle and raw SQL (Kysely/node-postgres) as alternatives
with potentially simpler raw-session-variable wiring.

## Decision

Use Prisma, and set tenant/identity context explicitly per request via
`SET LOCAL`-equivalent session variables (`app.current_org_id`,
`app.current_user_id`) inside a Prisma interactive transaction
(`prisma.$transaction`), through a `withTenantContext(req, fn)` helper.
Services and repositories receive the transaction client (`tx`) as an
explicit parameter — they never import the global `prisma` client for
tenant-owned tables. Full pattern in `docs/SECURITY.md`.

## Alternatives Considered

- **Drizzle:** closer to raw SQL, arguably easier to wire session
  variables into, but weaker migration tooling and smaller ecosystem.
- **Raw SQL / Kysely:** maximum control, most boilerplate, worst velocity
  for a solo developer.
- **Prisma Client Extensions to automate `SET LOCAL` injection:** considered
  as a future ergonomic improvement, but rejected for now in favor of an
  explicit, traceable helper function — more legible for code review and
  for this project's portfolio/learning goals.

## Consequences

- Every tenant-scoped DB operation must go through `withTenantContext`;
  this is enforced by convention (and should be enforced by a lint rule
  once services exist) rather than by the type system alone.
- Transactions are kept short-lived (scoped to the DB work of a request,
  not wrapping slow non-DB I/O like emails or Stripe calls).
