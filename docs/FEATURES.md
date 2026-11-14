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
**Milestone:** 0 · **Status:** COMPLETED · **Scope tier:** Core MVP
- **Purpose:** Let a psychologist create an account and sign in.
- **Acceptance criteria:** Sign up with email/password creates a Supabase
  Auth user and a matching `profiles` row; login issues a session the
  frontend can use; invalid credentials are rejected with a clear error.
  **All verified** against the real project (see `docs/ROADMAP.md`
  Milestone 0 DoD). The `profiles` row is created by `POST /auth/bootstrap`
  rather than a trigger on `auth.users`, because custom roles cannot touch
  that schema ([ADR-0011](decisions/0011-profiles-auth-fk-via-privileged-connection.md)).
- **Modules/files:** `apps/api/src/shared/middleware/require-auth.ts`,
  `apps/web/src/components/login-form.tsx`,
  `apps/web/src/lib/supabase/*`, `apps/web/src/proxy.ts`.
- **Key decisions:** [ADR-0008](decisions/0008-supabase-auth-independent-verification.md)
  — the project uses asymmetric (ES256) signing keys, so the API verifies
  against the JWKS endpoint and holds no signing secret.
- **Security considerations:** JWT verified in Express against JWKS with the
  issuer pinned; identity never taken from a header, body or query. All
  verification failures return an identical 401.
- **Tests:** 5 automated tests cover rejection of missing/non-bearer/empty/
  malformed tokens and that failures are indistinguishable
  (`require-auth.test.ts`). Since Milestone 1 the integration suite also
  runs the real `requireAuth` end to end against a JWKS endpoint it serves
  itself: valid token accepted; expired, tampered (payload altered,
  signature kept), unsigned (`alg: none`) and wrong-issuer tokens rejected
  (`tenant-isolation.test.ts`). The one thing still verified only manually
  is Supabase's own sign-up/sign-in (it needs the live project).
- **Fixed in Milestone 1:** `POST /auth/bootstrap` was not safe under
  concurrency — two simultaneous first sign-ins (two tabs, or React Strict
  Mode in development) both read "no profile yet", so one failed with a 500
  and, in the profile-exists-but-no-membership case, both would have created
  a practice. Found in the browser against the real project (the latency
  made the overlap happen); now serialized per user with a
  transaction-scoped advisory lock (`lockAccount`), and covered by a
  deterministic regression test (`bootstrap-concurrency.test.ts`) that
  failed before the fix.

### F-002 — Password Recovery
**Milestone:** 0 · **Status:** NOT STARTED
- **Purpose:** Let a user reset a forgotten password.
- **Acceptance criteria:** Reset email sent via Supabase Auth; reset link
  expires appropriately; old sessions are not silently trusted after reset.
- **Modules/files:** TBD.
- **Security considerations:** rate limit reset requests.
- **Required tests:** reset flow end to end; expired token rejected.

### F-003 — Organization Creation & Membership
**Milestone:** 0–1 · **Status:** COMPLETED · **Scope tier:** Core MVP — **including the invite flow, pulled forward from Extended MVP on 2026-11-14** ([ADR-0013](decisions/0013-organization-invitations.md) records why)
- **Purpose:** Create an organization and manage who belongs to it.
- **Acceptance criteria (Core MVP):** Signing up auto-creates an
  organization with the creator as `owner`; a user can belong to
  multiple organizations and switch the active one; an `owner` can invite
  a `psychologist` or `admin_staff` by email, and only the invited address,
  holding the link, can join — with exactly the invited role.
- **Done:**
  - Bootstrap: signing up auto-creates a solo practice with the creator as
    `owner`, idempotently (`POST /auth/bootstrap`, `modules/accounts/`).
  - Active-organization switcher on the dashboard (shown when the user has
    more than one active membership). The choice is a `localStorage`
    preference only; the API re-verifies membership on every request and
    the role shown comes from that verification, not from the cached list.
  - Invitations (`modules/organizations/`): create / list / revoke (owner
    only, `organization.manage`) and accept (`POST /invitations/accept`).
    One-time link token in the URL fragment, only its SHA-256 hash stored,
    7-day expiry, bound to the invitee's verified email; enforced
    independently by RLS, column-level grants and CHECK constraints. UI: a
    "Team" panel for owners and `/invitations/accept`.
- **Verified on the real project (2026-11-14):** migrations applied to
  Supabase; browser pass with synthetic `@example.test` accounts against the
  real Auth + database: owner invites a psychologist, an admin_staff and a
  second owner-of-their-own-practice; a duplicate (different case) is
  refused; a revoked link and a leaked link used by another account both
  get the generic "not valid" message and write nothing; the invitee joins
  with exactly the invited role, without a spurious solo practice; a
  psychologist/admin_staff sees no Team panel and gets 403 from the API;
  the multi-org user switches organizations and the role and Team panel
  follow the server-verified membership. Only the token hash is stored
  (checked in the database). Three defects were found by this pass and
  fixed: a bootstrap race (below), a second link opened in the same tab
  being ignored, and identical "My practice" entries in the switcher (now
  "name — role").
- **Modules/files:** `apps/api/src/modules/organizations/`,
  `apps/web/src/components/{account-panel,invitations-panel,accept-invitation}.tsx`,
  `apps/web/src/app/invitations/accept/page.tsx`,
  `packages/db/prisma/migrations/20261114120000_invitations/`.
- **Key decisions:** [ADR-0005](decisions/0005-enum-based-roles-for-mvp.md),
  [ADR-0013](decisions/0013-organization-invitations.md).
- **Security considerations:** `UNIQUE(organization_id, user_id)`; invite
  acceptance validated server-side (token hash + verified email), never
  trusted from the client; every acceptance failure is the same 404;
  inviting an `owner` is impossible (API + CHECK). **Deployment
  requirement:** Supabase "Confirm email" must be on (ADR-0013).
- **Tests:** unit — `invitations.test.ts` (12, use cases with in-memory
  fakes). Integration (real Postgres) — `invitations.test.ts` (19: full
  stack + RLS-only, incl. leaked link, single use, expiry, revocation,
  role escalation, column grants, no DELETE), `tenant-isolation.test.ts`
  (multi-org membership and role switching; duplicate membership rejected
  by the DB directly; suspended member loses access).

### F-004 — Role-Based Access Control Middleware
**Milestone:** 1 · **Status:** COMPLETED · **Scope tier:** Core MVP (mechanism); exercised with all three roles starting in Extended MVP
- **Done:** `resolveOrganization` verifies an active membership for the
  requested organization and attaches the caller's role to the request
  (404, never 403, on a non-membership). `requireRole(PERMISSIONS[action])`
  then gates the route on that DB-verified role, responding `403 FORBIDDEN`
  before the handler (and so before any query for the resource) runs. The
  matrix from `docs/SECURITY.md` lives once in code as the static
  `PERMISSIONS` constant — not an RBAC engine (ADR-0005). Applied to
  `GET /organizations/current` (`organization.read`).
- **Scope note:** the author-only clinical-note edit rule is a
  *resource-level* rule (it depends on the note's `author_id`, not the
  caller's role), so it cannot be decided by this middleware; it is
  enforced and tested under F-009. Each future route's allowed/denied role
  cases are tested as part of that route's own feature.
- **Purpose:** Uniformly enforce the role permission matrix on every route.
- **Acceptance criteria:** A route declares its required role(s) per
  the permission matrix in `docs/SECURITY.md`
  ([ADR-0010](decisions/0010-role-permission-matrix.md)); a member
  without that role is rejected before any DB query for the resource
  runs. The mechanism must be correct for all three roles even though
  Core MVP pilots (solo practices) will only ever exercise `owner`.
- **Modules/files:** `apps/api/src/shared/authorization/permissions.ts`,
  `apps/api/src/shared/middleware/require-role.ts`.
- **Security considerations:** this is the first authorization gate;
  RLS is the independent second gate — see
  [ADR-0003](decisions/0003-defense-in-depth-tenant-isolation.md).
- **Tests:** `require-role.test.ts` (46 tests) — every role × every action
  in the matrix, allowed and denied, asserting the handler never runs on a
  denial; the clinical-sessions read/write split and `admin_staff`'s total
  exclusion from clinical notes are both covered. The expected table is
  transcribed independently from `docs/SECURITY.md` rather than read from
  `PERMISSIONS`, so editing one without the other fails the suite
  (verified by mutating `payments.refund` → 2 failures). Also: a route
  missing `resolveOrganization` fails with 500 instead of falling through,
  and an empty role list is refused at startup.

### F-005 — Patient Management (CRUD)
**Milestone:** 2 · **Status:** COMPLETED (2026-11-14) · **Scope tier:** Core MVP
- **Purpose:** Register, edit, and view patients.
- **Acceptance criteria:** Create/read/update available to `owner`,
  `psychologist`, and `admin_staff`; delete/archive restricted to
  `owner` only (see the permission matrix, `docs/SECURITY.md`).
  Pagination and basic search work.
  **As built:** "delete" is **archive/restore** — nothing is ever deleted
  ([ADR-0014](decisions/0014-patients-archived-not-deleted.md)); archived
  patients are read-only for everyone until an owner restores them.
  Page-based pagination (`page`/`pageSize` ≤ 100, `total`), case-insensitive
  search over name/email/phone (LIKE wildcards escaped), status filter.
- **Modules/files:** `apps/api/src/modules/patients/` (domain, ports, use
  cases, Prisma adapter, routes); `packages/types/src/patients.ts`;
  migration `20261115100000_patients` + `app_private.has_active_role` in
  `packages/db/sql/rls-helpers.sql`; web: `apps/web/src/app/patients/`,
  `apps/web/src/components/patients/`, `lib/use-active-organization.ts`.
- **Verified:** `apps/api/test/integration/patients.test.ts` (role matrix,
  validation, pagination/search, cross-tenant 404s, RLS-only: outsider,
  suspended member, creator spoofing, non-owner archive/restore refused by
  the policy, no DELETE grant, no column grant on organization/creator,
  CHECK constraints and composite FK bypassing the app);
  `verify-rls-isolation.mjs` 10/10 against the live project; browser pass
  with the synthetic test accounts (2026-11-14): Ana (owner) create / edit /
  archive / restore / search in en+es; Carla (admin_staff) edits but gets
  `403` on archive/restore, `400` when smuggling `organizationId` or
  `status: archived`; Mallory gets `404` for Ana's patient under her own and
  under Ana's organization header.
- **Security considerations:** org-scoped RLS (`docs/SECURITY.md`); no
  `national_id` or other unjustified field collected
  (`docs/DATA-INVENTORY.md`); `organizationId` is always taken from the
  trusted tenant context, never from client-supplied request data (see
  the repository mapping pattern in `docs/ARCHITECTURE.md`).
- **Required tests:** cross-tenant isolation (full-stack **and** RLS-only,
  per `docs/SECURITY.md`); `admin_staff` allowed to create/read/update but
  rejected on delete.

### F-006 — Appointment Scheduling & Calendar
**Milestone:** 3 · **Status:** COMPLETED (2026-11-14) · **Scope tier:** Core MVP
- **Purpose:** Day/week/month calendar; create/edit/cancel/reschedule appointments.
- **Acceptance criteria:** All CRUD operations respect the composite FKs
  (patient and professional must belong to the same org); rescheduling
  updates the existing row's time range, not cancel+recreate. Available
  to `owner`, `psychologist`, and `admin_staff` per the permission matrix
  (`docs/SECURITY.md`).
- **As built:** day/week/month calendar (browser time zone, Monday-first
  weeks, view state in the URL), book / reschedule (same row) / reassign /
  record outcome / cancel; patient page lists upcoming appointments.
  Cancelled appointments are final and nothing is deleted
  ([ADR-0015](decisions/0015-appointment-conflicts-per-organization.md)).
  Only an active owner/psychologist can be the professional; archived
  patients cannot be booked.
- **Modules/files:** `apps/api/src/modules/appointments/`,
  `GET /organizations/current/members` (organizations module);
  `packages/types/src/appointments.ts`; migration
  `20261115110000_appointments`, `sql/extensions.sql`,
  `app_private.is_active_clinician`; web: `apps/web/src/app/appointments/`,
  `components/appointments/`, `lib/calendar.ts`.
- **Required tests:** see F-007. Verified in
  `apps/api/test/integration/appointments.test.ts` (role matrix, lifecycle,
  validation, calendar window, cross-tenant 404s, RLS-only) and in the
  browser with the synthetic accounts (2026-11-14): Ana books, hits a
  professional and a patient conflict (translated messages), books
  back-to-back, reschedules in place, is refused an early "completed",
  cancels; day/week/month views and the professional filter; Carla
  (admin_staff) books/confirms/cancels but gets `422 INVALID_PROFESSIONAL`
  as the professional; Mallory gets `404` for everything of Ana's.

### F-007 — Appointment Conflict Prevention
**Milestone:** 3 · **Status:** COMPLETED (2026-11-14) · **Scope tier:** Core MVP
- **Purpose:** Prevent a professional (and a patient) from being double-booked.
- **Acceptance criteria:** An overlapping, non-cancelled appointment for
  the same professional (or same patient) is rejected — at the database
  level, not only in application code.
- **Key decisions:** exclusion constraints in `docs/DATABASE.md`.
- **Required tests:** a test that attempts the conflicting insert
  **directly against the database**, bypassing the application layer, to
  prove the constraint — not just the app-level check — holds.
  **Done:** the "F-007 definition of done" block in `appointments.test.ts`
  inserts and updates with the privileged client (no API, no RLS) and is
  refused by `no_professional_overlap` / `no_patient_overlap`; back-to-back
  and cancelled overlaps are accepted. As built, the constraints are scoped
  per organization (ADR-0015) and there is no app-level pre-check — the
  constraint is the only one, mapped to `409`.

### F-008 — Clinical Session Recording
**Milestone:** 4 · **Status:** COMPLETED (2026-11-14) · **Scope tier:** Core MVP (minimal flow)
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
- **As built:** `apps/api/src/modules/clinical/`, migration
  `20261115120000_clinical_sessions_notes_audit`; recording from an
  appointment links it (one session per appointment, same patient via
  composite FK) and marks it completed; no future-dated sessions; archived
  patients get none. UI: patient page "Sessions", appointment "Record
  session", `/clinical-sessions/[id]`. Verified in
  `apps/api/test/integration/clinical.test.ts` and in the browser.

### F-009 — Clinical Notes (versioned)
**Milestone:** 4 · **Status:** COMPLETED (2026-11-14) · **Scope tier:** Core MVP
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
  RLS-only non-author-edit-blocked test; an application-layer
  non-author-edit-rejected test (the author-only rule is resource-level, so
  it lives here rather than in F-004's role middleware); audit log entry
  per read/write.
- **As built ([ADR-0016](decisions/0016-clinical-notes-immutable-rows.md)):**
  one note per author per session; the current text is the highest version
  (no pointer — notes and versions are immutable rows, no UPDATE/DELETE
  grants); `baseVersion` turns concurrent edits into `409 NOTE_STALE`;
  archived patients' records are frozen. All required tests pass: RLS-only
  `admin_staff` blocked (zero rows, inserts refused), RLS-only non-author
  version refused, API non-author `403 NOT_NOTE_AUTHOR`, audit row per
  read/write verified. UI: own note editor (new version on save), colleagues'
  notes read-only, history on demand, spell-check off.

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
**Milestone:** 4 (introduced), ongoing · **Status:** COMPLETED for clinical notes (2026-11-14); extend to new sensitive resources as they appear
- **Purpose:** Accountability trail, especially for clinical note access.
- **Acceptance criteria:** Every clinical-note read/write produces an
  `audit_logs` entry with actor, action, resource, and timestamp.
- **Required tests:** entry created for read and for write; entry
  correctly scoped to the acting user's organization.
- **As built:** `shared/audit/` (port + Prisma adapter), written in the same
  transaction as the access (fail closed); `audit_logs` INSERT-only for the
  app (no SELECT); action vocabulary enforced by CHECK; no content, no IP.
  Reviewing the trail is out-of-band until an owner-facing view exists.

### F-013 — Language Preference (persisted)
**Milestone:** 1 · **Status:** COMPLETED · **Scope tier:** Core MVP (simple toggle, persisted); a dedicated, fuller settings page is Extended MVP
- **Purpose:** Let a user switch between English and Spanish, persisted
  to their profile so it follows them across devices — not deferred,
  even though a polished settings page can wait.
- **Acceptance criteria (Core MVP):** A simple, reachable control (not
  necessarily a full settings page) updates the UI immediately and
  persists to `profiles.locale` via a small dedicated endpoint; the
  preference applies on next login from any device. **The richer
  settings-page experience (language as one section among several
  account preferences) is Extended MVP.**
- **Done:** `PATCH /me` (`.strict()` body `{ locale }`, own profile only);
  `profiles_locale_supported` CHECK constraint; a language selector in the
  root layout header (every page); resolution order profile → cookie →
  `Accept-Language` → `en`. The profile step is applied client-side: after
  sign-in the dashboard copies `profiles.locale` into the `NEXT_LOCALE`
  cookie, so the server only reads the cookie (no API call per render).
- **Verified on the real project (2026-11-14):** migrations applied to
  Supabase; browser pass with synthetic `@example.test` accounts against the
  real Auth + database: switching to Spanish while signed in updates the
  UI at once and persists `profiles.locale = 'es'`; a fresh browser (no
  cookie, `Accept-Language: en-US`) comes up in English and switches to
  Spanish on sign-in; a different user whose profile says `en` gets
  English in the same browser (profile outranks cookie).
- **Modules/files:** `apps/api/src/modules/accounts/application/use-cases/update-locale.ts`,
  `apps/web/src/components/locale-switcher.tsx`, `apps/web/src/i18n/request.ts`,
  `apps/web/src/lib/locale.ts`.
- **Key decisions:** [ADR-0007](decisions/0007-english-first-i18n.md).
- **Security considerations:** locale validated against the supported set
  by Zod **and** a DB CHECK; the updated profile is always the token
  subject's, re-checked by the `profiles_self_update` policy.
- **Tests:** `locale.test.ts` (8, integration) — persists across a new
  session (fresh token); unsupported / missing / extra-field bodies → 400
  with nothing written; un-bootstrapped caller → 404; RLS-only: one user
  cannot change another's locale; the DB rejects `fr` even from a
  privileged connection. `Accept-Language` parsing and the cookie/header
  precedence checked by a server-render smoke test (not automated — the
  web app has no test runner yet).

---

> Before adding a new feature here, check whether it's already covered
> by an existing entry's scope — don't fragment one feature into many
> rows just to track sub-tasks; use the acceptance criteria for that.
