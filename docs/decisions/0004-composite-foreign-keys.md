# ADR-0004: Composite foreign keys to prevent cross-organization relationships

**Status:** Accepted
**Date:** 2026-11-09

## Context

A plain foreign key (e.g. `appointments.patient_id → patients.id`)
guarantees the referenced row exists, but not that it belongs to the same
organization as the referencing row. Relying on application code alone to
enforce "same org" on every relationship is exactly the kind of
easy-to-miss check that defense-in-depth is meant to guard against.

## Decision

Every tenant-owned parent table exposes a compound unique constraint
`UNIQUE (id, organization_id)`. Every child reference that could
otherwise cross organizations uses a **composite foreign key** against
both columns, e.g.:

```sql
ALTER TABLE appointments
  ADD CONSTRAINT appointments_patient_same_org
    FOREIGN KEY (patient_id, organization_id) REFERENCES patients (id, organization_id);
```

Any column referencing "a user acting within an org" (professional,
author, assignee) uses a composite FK against `memberships (user_id,
organization_id)` rather than against `profiles`, since `profiles` has no
organization concept. Full list of affected columns: `docs/DATABASE.md`.

## Alternatives Considered

- **Application-level checks only:** rejected — this is precisely the
  category of bug a composite FK makes structurally impossible rather
  than just logically unlikely.
- **A trigger-based check:** more flexible but more code to maintain and
  test; a composite FK is a built-in, zero-maintenance Postgres feature
  that does the same job here.

## Consequences

- Slightly more verbose schema (extra unique constraints), fully
  supported by Prisma via `@@unique` plus multi-field `@relation`.
- Cross-organization data corruption becomes a constraint violation at
  write time, not a possible silent bug.
