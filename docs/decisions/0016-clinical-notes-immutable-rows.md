# ADR-0016: Clinical notes — one immutable note per author per session, numbered versions, audited access

**Status:** Accepted — amends [ADR-0006](0006-append-only-clinical-note-versions.md)
**Date:** 2026-11-14

## Context

ADR-0006 decided append-only versioning and sketched it with a
`clinical_notes.current_version_id` pointer to the latest version. Building
Milestone 4 surfaced three problems with the pointer:

- It makes `clinical_notes` **updatable** (every edit advances the pointer),
  so `app_runtime` would need `UPDATE` on the table that holds authorship —
  and an UPDATE policy to get exactly right.
- Note and version reference each other (circular FK), so creating a note
  takes three statements and a deferred constraint.
- Two concurrent edits can both insert a version and race on the pointer;
  the loser's text silently stops being "current".

F-009 also leaves open how many notes a session has, and F-012 requires every
read and write to be audited.

## Decision

- **No pointer.** A note's current text is its **highest-numbered version**.
  `clinical_note_versions (clinical_note_id, version)` is UNIQUE.
  Consequently `clinical_notes` is **fully immutable**: `app_runtime` has no
  UPDATE or DELETE on it, nor on `clinical_note_versions`. ADR-0006's core
  decision — edits insert, never update — is unchanged and now enforced by
  grants, not only by code.
- **One note per (session, author).** Co-therapists each keep their own note;
  nobody shares a note they cannot edit.
- **Optimistic concurrency.** Adding a version requires `baseVersion`; the
  server writes `baseVersion + 1`. A stale base (another tab or device saved
  first) is a `409 NOTE_STALE`, and the UNIQUE constraint decides any true race.
- **Author-only writes, in RLS.** The versions INSERT policy requires the
  note's `author_id` to be the caller; every policy re-derives the clinical
  role from `memberships` (`app_private.has_active_role`). For `admin_staff`
  the notes and versions tables return no rows at all.
- **Audit (F-012).** Every read (per note returned), creation, revision and
  history read writes an `audit_logs` row **in the same transaction** — an
  access whose audit fails, fails. `audit_logs` is INSERT-only for
  `app_runtime` (no SELECT): the app cannot read or alter its own trail.
  Entries hold identifiers and version numbers, **never content**; a CHECK
  restricts `action` / `resource_type` to a machine vocabulary.
- **Archived patients' records are frozen** (ADR-0014): no new sessions
  (RLS + API), notes or versions (API).
- **Transport and logging:** note responses are `Cache-Control: no-store`;
  Prisma validation errors (which echo arguments) are logged without their
  message; the UI disables spell-check on note fields.
- Sessions: at most one per appointment, of the **same patient** (composite
  FK on `appointments (id, organization_id, patient_id)`); recording one
  marks the appointment completed.

## Alternatives Considered

- **Keep `current_version_id` (ADR-0006 as written).** Rejected for the
  three reasons above; "latest version" is one indexed lookup.
- **One shared note per session.** Either nobody but its first author could
  write to it, or the author-only rule (ADR-0010) would have to go.
- **Audit with a trigger.** Triggers see writes, not reads — and reads are
  exactly what F-012 is about.
- **Let owners read the audit log through the app now.** Deferred: no
  feature needs it yet, and a SELECT grant on the trail is a decision of its
  own (who may see who read what).

## Consequences

- Corrections to a note are new versions; a note cannot be deleted or
  re-attributed through the application.
- Reviewing the audit trail is a privileged, out-of-band operation until an
  owner-facing view is designed (tracked in the roadmap).
- The IP address is **not** recorded (data minimization); whether it should
  be is a question for the Milestone 6 legal review.
