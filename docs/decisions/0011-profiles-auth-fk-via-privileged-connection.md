# ADR-0011: `profiles` → `auth.users` foreign key applied via the privileged admin connection, not Prisma

**Status:** Accepted
**Date:** 2026-11-09

## Context

While implementing Milestone 0.5's schema (`profiles`, `organizations`,
`memberships`), adding the real database-level foreign key from
`profiles.id` to Supabase's `auth.users.id` turned out to be impossible
for `app_migrator` (the role Prisma Migrate connects as) specifically
because of it.

Empirically confirmed: `GRANT USAGE ON SCHEMA auth TO app_migrator` and
`GRANT REFERENCES ON auth.users TO app_migrator` both report success with
no error, but `has_schema_privilege('app_migrator', 'auth', 'USAGE')`
returns `false` immediately afterward, even within the same session. This
is a deliberate Supabase platform safeguard protecting the `auth` schema
from customer-created roles — not an ordinary ACL that a GRANT can route
around, and not something to keep retrying (see the Supabase skill's
"recover from errors, don't loop" principle).

The privileged admin connection (`supabase db query`, which connects as
`postgres`) does have direct usage rights on `auth.users` — it can
reference that table directly — but it does not *own* the `profiles`
table (Prisma's `app_migrator` does), and `ALTER TABLE ADD CONSTRAINT`
requires ownership.

## Decision

Run `GRANT app_migrator TO postgres;` once, then add the FK constraint as
`postgres`, in the same statement, via the privileged admin connection
(`packages/db/sql/profiles-auth-fk.sql`, applied with
`supabase db query --remote --yes --file ...`) — **never** as part of a
Prisma migration.

This works because PostgreSQL's ownership checks for `ALTER`/`DROP`
accept inherited role membership (not just literal `current_user`
equality or an explicit `SET ROLE`): `postgres` satisfies the "owner of
`profiles`" check via its inherited membership in `app_migrator`, while
still using its own direct, non-delegable privilege on `auth.users` in
that same statement. (A `SET ROLE app_migrator` approach would not work
here — it would swap the session's effective identity entirely, losing
`postgres`'s direct `auth.users` access rather than adding to it.)

## Alternatives Considered

- **Keep retrying the `GRANT ... TO app_migrator` approach with different
  privilege combinations:** rejected after the second confirmation that
  grants on `auth` silently don't persist — this is a platform-level
  restriction, not a privilege-syntax problem.
- **Have `app_migrator` own nothing in `auth`, and instead create a
  trigger on `auth.users` to sync into `profiles`:** a legitimate
  alternative for keeping `profiles` in sync going forward, but creating
  a trigger *on* `auth.users` hits the exact same "no custom-role access
  to the `auth` schema" wall — would need the same privileged-connection
  pattern this ADR establishes anyway. Not needed yet since there is no
  signup flow to trigger from in Milestone 0.5; revisit when
  Supabase Auth integration (item 3 of the post-Milestone-0 work) is
  implemented.

## Consequences

- Any future change that needs to reference or trigger on Supabase's
  `auth` (or likely `storage`, `realtime`) schema must go through this
  same pattern: a one-time, manually-run, privileged-connection SQL
  script tracked in `packages/db/sql/`, never a Prisma migration.
- `packages/db/sql/` is a new, deliberately small category of
  infrastructure SQL that lives outside Prisma's migration history —
  documented here so it isn't mistaken for dead code or accidentally
  folded into a future Prisma migration.
