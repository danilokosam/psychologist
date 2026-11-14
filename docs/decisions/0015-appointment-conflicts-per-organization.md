# ADR-0015: Appointment double-booking is prevented by database exclusion constraints, scoped per organization

**Status:** Accepted
**Date:** 2026-11-14

## Context

F-007 requires that an overlapping, non-cancelled appointment for the same
professional, or the same patient, is rejected **at the database level, not
only in application code**, and Milestone 3's definition of done asks for a
test that proves it with a direct insert that bypasses the application.

`docs/DATABASE.md` sketched the two exclusion constraints keyed on
`professional_id` alone. Two facts surfaced while building them:

- A professional can belong to **several organizations** (F-003; the
  synthetic `diego.owner` account does). An exclusion constraint on
  `professional_id` alone would compare appointments across practices.
- Constraint checks run **outside RLS**: they see every row. When one
  practice's booking collided with another practice's, the error returned to
  the first one would reveal that the professional has an appointment at that
  time somewhere else — information about another tenant's calendar, i.e. a
  cross-tenant leak through an error message.

## Decision

- Two GiST exclusion constraints, each including `organization_id WITH =`:
  `no_professional_overlap (organization_id, professional_id, range)` and
  `no_patient_overlap (organization_id, patient_id, range)`, with
  `range = tstzrange(scheduled_start, scheduled_end, '[)')` and
  `WHERE status <> 'cancelled'`.
  - **Half-open** ranges: back-to-back appointments (10:00–11:00, 11:00–12:00)
    are allowed.
  - **Only `cancelled` frees a slot**: scheduled, confirmed, completed and
    no-show all represent time that was taken.
- **Per organization.** A professional working in two practices is
  responsible for not double-booking themselves *across* them; each practice's
  own calendar is airtight. (Patients are per organization anyway — a patient
  row belongs to exactly one practice — so `organization_id` adds nothing on
  that side but symmetry.)
- `btree_gist` is required for the uuid equality parts. It is installed by a
  new privileged script, `packages/db/sql/extensions.sql`, into Supabase's
  `extensions` schema (app_migrator cannot `CREATE EXTENSION`).
- The API maps the violation to `409 PROFESSIONAL_CONFLICT` /
  `PATIENT_CONFLICT`. There is no application-level overlap pre-check: it
  would be a race (two requests both pass it) and a second source of truth.
  The constraint is the only check, and the error names which side collided.
- Related rules decided in the same change (same migration, enforced in the
  API **and** in RLS):
  - the professional must be an **active `owner` or `psychologist`**
    (`app_private.is_active_clinician`); `admin_staff` cannot be booked;
  - **archived patients cannot be booked** (ADR-0014);
  - appointments are **cancelled, never deleted** (no DELETE grant) and a
    cancelled appointment is **final** (the update policy's USING excludes
    it) — the history matters for payments in Milestone 5;
  - **rescheduling updates the same row** (F-006), and the patient of an
    appointment can never change (no column grant);
  - an outcome (`completed` / `no_show`) can be recorded only once the
    appointment has started (API only — a CHECK cannot depend on the clock).

## Alternatives Considered

- **Constraints on `professional_id` alone (the original sketch).** Prevents
  a multi-practice professional's cross-practice double-booking, but leaks the
  other practice's schedule through the conflict error. Rejected: tenant
  isolation outranks a convenience for a minority of users.
- **Application-level overlap check only.** Explicitly rejected by F-007:
  racy, and bypassable by any code path that forgets it.
- **Trigger that checks for overlaps.** Same race unless it takes a lock; an
  exclusion constraint is the purpose-built, index-backed mechanism.
- **Per-professional availability across organizations, via a SECURITY
  DEFINER "is this person free" function.** Would still leak a busy/free bit
  about another tenant. Not built.

## Consequences

- A professional in two practices can be double-booked across them; the UI
  shows only the active practice's calendar. If that becomes a real need, the
  answer is a personal cross-practice view built from the user's *own*
  memberships, not a weaker constraint.
- Rebuilding the database from scratch now needs `sql/extensions.sql` before
  `sql/rls-helpers.sql` and `migrate:deploy` (README, CLAUDE.md).
- Prisma does not model exclusion constraints; the drift check ignores them,
  so the integration suite is what guards them (the F-007 tests insert
  directly with the privileged client).
