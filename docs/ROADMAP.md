# Roadmap

Work proceeds milestone by milestone, feature by feature within each
milestone — not in parallel across milestones. See `docs/FEATURES.md` for
the feature-level tracker and `CLAUDE.md` for the working agreement this
implies (explain before implementing, verify before marking complete).

## Status legend
`NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `COMPLETED`

## Milestones

### Milestone 0 — Foundations
**Status: COMPLETED** — delivered in three passes: tooling/scaffolding,
then real Supabase infrastructure (schema + RLS), then auth wiring and
the tenant-context plumbing.

Objective: a deployable skeleton with the security/tenancy model proven,
not yet any real feature.

Done:
- [x] Monorepo scaffolding (`apps/web`, `apps/api`, `packages/db`, `packages/types`, `packages/config`) — pnpm workspaces, no Turborepo.
- [x] Shared strict TypeScript config + ESLint flat config (`packages/config`).
- [x] `@psych/types` with one real shared schema (`HealthCheckResponse`), used by both apps.
- [x] Express skeleton: `/health` endpoint, centralized error handling, Zod-validated env vars at startup.
- [x] Next.js skeleton: next-intl wired (`en`/`es` catalogs, no URL prefixes per ADR-0007), a page that fetches `/health` from the API over HTTP and renders it.
- [x] Prisma installed in `packages/db` (datasource/generator only, **zero models yet** — see note above).
- [x] Data inventory drafted (`docs/DATA-INVENTORY.md`).
- [x] CI: lint, typecheck, test, build on push (`.github/workflows/ci.yml`).
- [x] `.env.example` files per app; no secrets committed.

Done since (Milestone 0.5 — real Supabase infrastructure):
- [x] Supabase project provisioned (EU region, `eu-central-1`), linked to this repo via the CLI (`supabase link`).
- [x] `app_migrator` / `app_runtime` DB roles provisioned — confirmed `NOBYPASSRLS`, not superuser.
- [x] Prisma schema v1: `profiles`, `organizations`, `memberships` (+ composite unique constraint on `memberships`), applied as real migrations.
- [x] RLS enabled + forced on all three tables, with real policies (see `docs/SECURITY.md`) — verified via `supabase db advisors` (two real issues found and fixed: an unindexed FK, and duplicate permissive policies merged into one each).
- [x] `profiles.id → auth.users.id` FK — applied via a separate privileged-connection path, not Prisma; see [ADR-0011](decisions/0011-profiles-auth-fk-via-privileged-connection.md).

Done in the final pass (auth + tenant context):
- [x] `withTenantContext` / `withUserContext` implemented, with `app_runtime`'s pooled (transaction-mode) connection wired into `apps/api`.
- [x] Startup assertion rejecting a `BYPASSRLS` role — verified live: `Database role "app_runtime" verified: Row Level Security applies.`
- [x] Supabase Auth wiring: JWKS/ES256 token verification in Express (`jose`), `@supabase/ssr` cookie sessions, login/sign-up UI, `/dashboard` protected by the Next.js proxy.
- [x] `modules/accounts/` built as the worked ports-and-adapters reference (ADR-0009): domain → ports → use cases → Prisma adapter → composition root → routes.
- [x] Endpoints `POST /auth/bootstrap`, `GET /me`, `GET /organizations/current` (see `docs/API.md`).
- [x] RLS-only cross-tenant isolation test passing 6/6, after it found and forced the fix of a real hole (ADR-0012).

**DoD: met.** Verified against the real project with two synthetic users:
sign up → account bootstrapped (profile + solo practice, `owner`
membership) → empty dashboard rendered behind a real session → a second
user received a 404, not a 403, for the first user's organization, at both
the application and RLS layers. The startup assertion rejects a
`BYPASSRLS` role. Synthetic fixtures were deleted afterwards; the tables
are empty.

Not part of the DoD as originally written, and still open: **deployment to
staging.** No Vercel/hosting setup exists yet — tracked as the first task
of whichever milestone we decide to deploy in.

### Milestone 1 — Organizations & Membership + RBAC
**Status: NOT STARTED**
- Invite flow, active-organization switcher, role-enforcement middleware.
- Language switcher in user settings, persisting `profiles.locale`.
- **DoD:** two seeded orgs; full cross-tenant isolation integration tests passing (app layer *and* RLS-only, per `docs/SECURITY.md`).

### Milestone 2 — Patients
**Status: NOT STARTED**
- Patient CRUD, pagination/search.
- **DoD:** RLS-on-patients verified by tests; data-inventory entries for any new field added before merge.

### Milestone 3 — Appointments / Calendar
**Status: NOT STARTED**
- CRUD, day/week/month views, both exclusion constraints (professional and patient overlap).
- **DoD:** no double-booking possible even via a direct DB insert (test bypasses the app layer to prove it).

### Milestone 4 — Clinical sessions & notes
**Status: NOT STARTED**
- Append-only note versioning, role-gated access, audit logging on note access.
- **DoD:** audit log entries verified in tests for every note read/write; admin_staff-blocked-by-RLS test passing even with the app-layer check removed.

### Milestone 5 — Payments & Dashboard
**Status: NOT STARTED**
- Payment ledger CRUD, dashboard aggregation queries.
- **DoD:** dashboard numbers match seeded data in tests.

### Milestone 6 — Hardening & beta prep
**Status: NOT STARTED**
- Rate limiting, error monitoring (Sentry), backup verification, privacy policy + DPA template, security review, DPIA completed, legal/DPO review of `docs/DATA-INVENTORY.md`.
- **DoD:** ready to onboard pilot psychologists under a signed beta agreement. **Real patient data is permitted only after this milestone's legal review is complete** — synthetic data only until then.

### Post-MVP (sequence by real customer feedback, not by this order)
Email reminders (Resend), Stripe subscription billing, clinic
multi-professional refinements, advanced reporting, patient portal,
WhatsApp integration.

> This file is updated as part of finishing each feature — not
> retroactively at the end of a milestone.
