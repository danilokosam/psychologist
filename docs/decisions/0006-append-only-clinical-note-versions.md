# ADR-0006: Append-only versioning for clinical notes

**Status:** Accepted — **amended by [ADR-0016](0016-clinical-notes-immutable-rows.md)** (no `current_version_id` pointer: the current version is the highest-numbered one, and notes are immutable rows)
**Date:** 2026-11-09

## Context

Clinical notes are the most sensitive data in the system, and clinical
record-keeping generally expects an auditable, immutable history of what
was written and when — not silent overwrites. `updated_at` timestamps
alone do not preserve what the note said *before* an edit.

## Decision

`clinical_notes` holds a pointer (`current_version_id`) to the latest row
in `clinical_note_versions`, an append-only table. Editing a note inserts
a new version row; it never updates `content` in place. Every version
records its author and timestamp.

## Alternatives Considered

- **In-place `UPDATE` with a separate `audit_logs` entry per edit:**
  possible, but reconstructing historical content would require replaying
  diffs or storing full snapshots in the audit log anyway — an append-only
  versions table is simpler and makes "what did this note say on date X"
  a direct query, not a reconstruction.

## Consequences

- Slightly more complex read path (resolve `current_version_id` to get
  current content), which should be hidden behind a service function.
- Clinical note storage grows with every edit — acceptable at this
  data volume, revisit only if it becomes a real cost.
