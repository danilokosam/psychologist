# ADR-0010: Role permission matrix for clinical and administrative resources

**Status:** Accepted
**Date:** 2026-11-09

## Context

The three fixed roles ([ADR-0005](0005-enum-based-roles-for-mvp.md)) need
a single, consistent definition of what each may do — administrative
staff must be able to manage patients/appointments/payments without ever
touching clinical notes, and even among clinically-privileged roles, one
professional should not be able to silently edit another's clinical
note.

## Decision

The matrix in `docs/SECURITY.md` ("Role permission matrix" section) is
authoritative; route-level `requireRole(...)` middleware and RLS policies
must both match it. Key points that are not simply "owner/psychologist
can do clinical things, admin_staff can't":

- **Clinical sessions are administratively readable but clinically
  writable**: `admin_staff` may read session metadata (needed to process
  payments) but may not create or edit sessions — only `owner`/
  `psychologist` can attest that a clinical encounter occurred.
- **Clinical note edits are author-restricted**: any `owner`/
  `psychologist` in the organization may read a note, but only its
  original author may add a new version. Enforced via `WITH CHECK
  (author_id = current_user)` on the `UPDATE` policy, independent of
  whatever the `USING` clause allows (see `docs/SECURITY.md`).
- **Destructive/higher-stakes actions are owner-only**: patient
  deletion/archival, payment refunds, and organization/membership
  management.

## Alternatives Considered

- **Restrict clinical note reads to the patient's assigned professional
  only** (not just any org psychologist): considered, but deferred as an
  open question — Core MVP customers are solo practices where this
  distinction is moot, and over-restricting now without a validated
  clinic customer need would be speculative. Revisit if a real clinic
  customer's policy differs.
- **Allow `admin_staff` to create clinical sessions** (treating
  "session happened" as a purely administrative/attendance fact):
  rejected — attesting that a clinical encounter took place is a
  clinical judgment, not an administrative one.
- **Assume `owner` is never a non-clinical business administrator**:
  accepted as a simplifying assumption for Core MVP (true for every
  target customer there), explicitly flagged as unresolved for a future
  Clinic-tier persona.

## Consequences

- Three separate RLS policies (`SELECT`/`INSERT`/`UPDATE`) are needed for
  `clinical_notes` instead of one `FOR ALL` policy, to express the
  author-only-edit rule correctly — see `docs/SECURITY.md` for the SQL.
- Every new role or resource added later must be checked against this
  matrix and the ADR updated (or superseded) rather than drifting from it
  silently in route code.
