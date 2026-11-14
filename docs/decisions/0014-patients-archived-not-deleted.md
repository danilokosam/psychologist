# ADR-0014: Patients are archived, never deleted, and archiving is owner-only down to RLS

**Status:** Accepted
**Date:** 2026-11-15

## Context

F-005 (Milestone 2) asks for patient create/read/update for every role and
"delete / archive" for `owner` only (`docs/SECURITY.md` matrix). Two things
make "delete" the wrong primitive for this table:

- **Retention.** A patient record is the anchor for appointments, clinical
  sessions, clinical notes and payments (Milestones 3–5, all with composite
  FKs to `patients (id, organization_id)`). How long a psychology practice in
  Spain must keep that record is an **open legal question**
  (`docs/DATA-INVENTORY.md`, open question 1). Deleting a patient may well be
  unlawful during the retention period; keeping them forever may be unlawful
  after it. Neither may be decided by assumption in code.
- **Irreversibility.** A misclick on "delete" destroys Article 9 data with no
  way back, and the delete permission is otherwise exactly the kind of
  capability a compromised owner session would use.

The matrix also needs the "owner only" rule to be a real control, not just
middleware: CLAUDE.md requires role rules to hold with the application layer
removed.

## Decision

- **Archive replaces delete.** `patients.status` is `active | inactive |
  archived` plus `archived_at` (a CHECK keeps them consistent). Archived
  patients are hidden from the working list, still readable by every role, and
  **read-only for everyone until restored**. The permission is renamed
  `patients.delete` → `patients.archive` and covers archive and restore.
- **No delete path at all.** `app_runtime` has no `DELETE` grant on
  `patients` and there is no DELETE policy or endpoint. Hard erasure (GDPR
  Art. 17 requests, end of retention) is **deferred to the Milestone 6 legal
  review**; when it is built it will be a deliberate, audited, owner-initiated
  procedure, not a CRUD verb.
- **Owner-only in RLS too.** The `patients_update` policy requires
  `app_private.has_active_role(organization_id, ARRAY['owner'])` whenever the
  row is archived *before* (USING) or *after* (WITH CHECK) the update. So a
  non-owner can neither archive (new row fails WITH CHECK), nor edit or
  restore an archived row (USING hides it). `has_active_role` is a new
  SECURITY DEFINER helper that re-derives the role from `memberships` on every
  call (ADR-0003, ADR-0012) and is meant to be reused for the clinical-note
  policies in Milestone 4.
- **Column-level UPDATE grant**: only the editable details, `status`,
  `archived_at`, `updated_at`. `organization_id`, `created_by`, `id` and
  `created_at` can never be rewritten through the application.
- **Fields deliberately left out** (data minimization, CLAUDE.md):
  `national_id` (unchanged decision); a free-text notes field (clinical content
  typed there would be visible to `admin_staff`, bypassing ADR-0010);
  `assigned_professional_id` and `consent_recorded_at`, both listed in the
  original `docs/DATABASE.md` design — no Milestone 2 feature uses them, and
  the consent one depends on the open Art. 9 legal-basis question. Each is
  added only with the feature that needs it.

## Alternatives Considered

- **Hard delete for owners, as the matrix literally says.** Rejected for the
  retention and irreversibility reasons above.
- **Soft delete via `deleted_at` (as first sketched in DATABASE.md).** Same
  effect as `archived`, but "deleted" rows that still exist and remain
  readable mislead everyone who reads the schema — and a status value fits
  the existing `active/inactive` lifecycle without a second mechanism.
- **Enforce "owner only" in the API alone.** Simpler policy, but a single
  missing `requireRole` would let `admin_staff` archive patients; the
  defense-in-depth rule (ADR-0003) exists for exactly that.
- **`DELETE /patients/:id` that archives.** Rejected: a DELETE that leaves the
  row in place is a lying API. Archive/restore are explicit `POST` actions.

## Consequences

- Organizations accumulate archived patients indefinitely until the
  Milestone 6 legal review defines retention and erasure. Tracked there.
- Every later table referencing patients can rely on the patient row
  existing; no cascade or orphan handling for patient deletion is needed.
- `PATCH` on an archived patient returns `409 PATIENT_ARCHIVED` for every
  role, owner included — an owner restores first. This keeps the archive a
  frozen record rather than a second working list.
