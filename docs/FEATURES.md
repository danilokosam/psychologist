# Feature Tracker

The authoritative, per-feature source of truth for implementation status.
A feature is marked **COMPLETED** only after: relevant tests pass,
acceptance criteria are verified, and its documentation (this entry, plus
`docs/API.md`/`docs/DATABASE.md` if applicable) is updated to match the
actual implementation — never because code was merely written. See
`CLAUDE.md` for the full verification procedure.

## Status legend
`NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `COMPLETED`

## Scope tier legend
**Core MVP** (ships first, minimal viable version) · **Extended MVP**
(richer version, follows shortly after initial validation) ·
**Post-MVP** (deferred until real demand evidence).

Several features below ship in Core MVP in a deliberately minimal form,
with a richer version deferred to Extended MVP — noted per feature.

---

### F-001 — User Registration & Login
**Milestone:** 0 · **Status:** NOT STARTED
- **Purpose:** Let a psychologist create an account and sign in.
- **Acceptance criteria:** Sign up with email/password creates a Supabase
  Auth user and a matching `profiles` row; login issues a session the
  frontend can use; invalid credentials are rejected with a clear error.
- **Modules/files:** TBD during implementation.
- **Key decisions:** [ADR-0008](decisions/0008-supabase-auth-independent-verification.md).
- **Security considerations:** JWT verification in Express, not trust of
  frontend-reported identity.
- **Required tests:** valid signup/login; invalid/expired/tampered JWT rejected.

### F-002 — Password Recovery
**Milestone:** 0 · **Status:** NOT STARTED
- **Purpose:** Let a user reset a forgotten password.
- **Acceptance criteria:** Reset email sent via Supabase Auth; reset link
  expires appropriately; old sessions are not silently trusted after reset.
- **Modules/files:** TBD.
- **Security considerations:** rate limit reset requests.
- **Required tests:** reset flow end to end; expired token rejected.

### F-003 — Organization Creation & Membership
**Milestone:** 0–1 · **Status:** NOT STARTED · **Scope tier:** Core MVP (solo-practice shape only)
- **Purpose:** Create an organization and manage who belongs to it.
- **Acceptance criteria (Core MVP):** Signing up auto-creates an
  organization with the creator as `owner`; a user can belong to
  multiple organizations and switch the active one. **The invite flow
  (adding a second `psychologist`/`admin_staff` member) is Extended MVP**
  — not required for a solo-practice pilot.
- **Modules/files:** TBD.
- **Key decisions:** [ADR-0005](decisions/0005-enum-based-roles-for-mvp.md).
- **Security considerations:** `UNIQUE(organization_id, user_id)`; invite
  acceptance (once built) validated server-side, not trusted from the client.
- **Required tests:** multi-org membership; duplicate-membership rejected.

### F-004 — Role-Based Access Control Middleware
**Milestone:** 1 · **Status:** NOT STARTED · **Scope tier:** Core MVP (mechanism); exercised with all three roles starting in Extended MVP
- **Purpose:** Uniformly enforce the role permission matrix on every route.
- **Acceptance criteria:** A route declares its required role(s) per
  the permission matrix in `docs/SECURITY.md`
  ([ADR-0010](decisions/0010-role-permission-matrix.md)); a member
  without that role is rejected before any DB query for the resource
  runs. The mechanism must be correct for all three roles even though
  Core MVP pilots (solo practices) will only ever exercise `owner`.
- **Modules/files:** TBD.
- **Security considerations:** this is the first authorization gate;
  RLS is the independent second gate — see
  [ADR-0003](decisions/0003-defense-in-depth-tenant-isolation.md).
- **Required tests:** every role × every protected route, both allowed
  and denied cases — including the clinical-notes author-only-edit rule
  and the clinical-sessions read/write split from the permission matrix.

### F-005 — Patient Management (CRUD)
**Milestone:** 2 · **Status:** NOT STARTED · **Scope tier:** Core MVP
- **Purpose:** Register, edit, and view patients.
- **Acceptance criteria:** Create/read/update available to `owner`,
  `psychologist`, and `admin_staff`; delete/archive restricted to
  `owner` only (see the permission matrix, `docs/SECURITY.md`).
  Pagination and basic search work.
- **Modules/files:** TBD.
- **Security considerations:** org-scoped RLS (`docs/SECURITY.md`); no
  `national_id` or other unjustified field collected
  (`docs/DATA-INVENTORY.md`); `organizationId` is always taken from the
  trusted tenant context, never from client-supplied request data (see
  the repository mapping pattern in `docs/ARCHITECTURE.md`).
- **Required tests:** cross-tenant isolation (full-stack **and** RLS-only,
  per `docs/SECURITY.md`); `admin_staff` allowed to create/read/update but
  rejected on delete.

### F-006 — Appointment Scheduling & Calendar
**Milestone:** 3 · **Status:** NOT STARTED · **Scope tier:** Core MVP
- **Purpose:** Day/week/month calendar; create/edit/cancel/reschedule appointments.
- **Acceptance criteria:** All CRUD operations respect the composite FKs
  (patient and professional must belong to the same org); rescheduling
  updates the existing row's time range, not cancel+recreate. Available
  to `owner`, `psychologist`, and `admin_staff` per the permission matrix
  (`docs/SECURITY.md`).
- **Modules/files:** TBD.
- **Required tests:** see F-007.

### F-007 — Appointment Conflict Prevention
**Milestone:** 3 · **Status:** NOT STARTED · **Scope tier:** Core MVP
- **Purpose:** Prevent a professional (and a patient) from being double-booked.
- **Acceptance criteria:** An overlapping, non-cancelled appointment for
  the same professional (or same patient) is rejected — at the database
  level, not only in application code.
- **Key decisions:** exclusion constraints in `docs/DATABASE.md`.
- **Required tests:** a test that attempts the conflicting insert
  **directly against the database**, bypassing the application layer, to
  prove the constraint — not just the app-level check — holds.

### F-008 — Clinical Session Recording
**Milestone:** 4 · **Status:** NOT STARTED · **Scope tier:** Core MVP (minimal flow)
- **Purpose:** Record that a session actually took place, distinct from
  the scheduled appointment.
- **Acceptance criteria:** A clinical session can be created by `owner`/
  `psychologist` only, linked to an appointment (optional) and always
  linked to a patient and professional within the same organization.
  `admin_staff` can read session metadata (date, duration, patient,
  professional) for billing purposes but cannot create or edit sessions
  (see the permission matrix, `docs/SECURITY.md`).
- **Required tests:** composite-FK cross-org rejection; `admin_staff`
  read-allowed/write-denied per the matrix.

### F-009 — Clinical Notes (versioned)
**Milestone:** 4 · **Status:** NOT STARTED · **Scope tier:** Core MVP
- **Purpose:** Private clinical notes tied to a session, with immutable history.
- **Acceptance criteria:** Creating/editing a note inserts a new
  `clinical_note_versions` row (never an in-place update); any `owner`/
  `psychologist` in the org can read a note, but **only the note's
  original author can add a new version** — not even another
  psychologist with full clinical access can edit it; `admin_staff`
  cannot read or write notes under any circumstance.
- **Key decisions:** [ADR-0006](decisions/0006-append-only-clinical-note-versions.md), [ADR-0003](decisions/0003-defense-in-depth-tenant-isolation.md), [ADR-0010](decisions/0010-role-permission-matrix.md).
- **Security considerations:** the role-aware RLS policies in
  `docs/SECURITY.md` — tested with the app-layer role check deliberately
  removed, to prove RLS alone blocks both `admin_staff` and a
  non-author psychologist's edit attempt.
- **Required tests:** the RLS-only `admin_staff`-blocked test; the
  RLS-only non-author-edit-blocked test; audit log entry per read/write.

### F-010 — Payment Ledger
**Milestone:** 5 · **Status:** NOT STARTED · **Scope tier:** Core MVP (minimal); refunds and revenue summaries are Extended MVP
- **Purpose:** Track session prices and whether a payment is pending or paid.
- **Acceptance criteria (Core MVP):** Record a price and a paid/pending
  status per session, linked to patient and optionally to a clinical
  session, org-scoped via composite FK. Available to `owner`,
  `psychologist`, and `admin_staff`; **refunds are `owner`-only and
  deferred to Extended MVP** along with monthly revenue summaries.
- **Required tests:** cross-tenant isolation; `admin_staff` allowed to
  mark paid/pending but rejected on refund (once that exists).

### F-011 — Dashboard Overview
**Milestone:** 5 · **Status:** NOT STARTED · **Scope tier:** Core MVP (trimmed); revenue/pending-payment tiles are Extended MVP
- **Purpose (Core MVP):** Today's/upcoming appointments, active patient
  count, completed sessions this period, cancellations. **Revenue and
  pending-payment tiles wait for Extended MVP's richer payment ledger
  (F-010).**
- **Acceptance criteria:** All figures are org-scoped and match seeded
  test data exactly.
- **Required tests:** aggregation query correctness per metric.

### F-012 — Audit Logging
**Milestone:** 4 (introduced), ongoing · **Status:** NOT STARTED
- **Purpose:** Accountability trail, especially for clinical note access.
- **Acceptance criteria:** Every clinical-note read/write produces an
  `audit_logs` entry with actor, action, resource, and timestamp.
- **Required tests:** entry created for read and for write; entry
  correctly scoped to the acting user's organization.

### F-013 — Language Preference (persisted)
**Milestone:** 1 · **Status:** NOT STARTED · **Scope tier:** Core MVP (simple toggle, persisted); a dedicated, fuller settings page is Extended MVP
- **Purpose:** Let a user switch between English and Spanish, persisted
  to their profile so it follows them across devices — not deferred,
  even though a polished settings page can wait.
- **Acceptance criteria (Core MVP):** A simple, reachable control (not
  necessarily a full settings page) updates the UI immediately and
  persists to `profiles.locale` via a small dedicated endpoint; the
  preference applies on next login from any device. **The richer
  settings-page experience (language as one section among several
  account preferences) is Extended MVP.**
- **Key decisions:** [ADR-0007](decisions/0007-english-first-i18n.md).
- **Security considerations:** standard input validation (locale must be
  one of the supported set); update restricted to the authenticated
  user's own profile.
- **Required tests:** switch persists across a simulated new session;
  unsupported locale value rejected; a user cannot update another
  user's `profiles.locale`.

---

> Before adding a new feature here, check whether it's already covered
> by an existing entry's scope — don't fragment one feature into many
> rows just to track sub-tasks; use the acceptance criteria for that.
