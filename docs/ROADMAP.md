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
**Status: COMPLETED** (2026-11-14) — code, automated tests, rollout to
Supabase and a browser pass against the real project.
- [x] Role-enforcement middleware — `requireRole` + the `PERMISSIONS` matrix (F-004).
- [x] Integration-test harness: throwaway Postgres in Docker (`docker-compose.test.yml`), production-shaped roles/RLS, real token verification against a local JWKS; also runs in CI.
- [x] Invite flow (F-003) — pulled forward from Extended MVP by product decision; why and how in [ADR-0013](decisions/0013-organization-invitations.md).
- [x] Language switcher persisting `profiles.locale` (F-013).
- [x] Active-organization switcher (F-003).

**DoD:** two seeded orgs; full cross-tenant isolation integration tests
passing (app layer *and* RLS-only, per `docs/SECURITY.md`). **Met by the
automated suite** — 55 integration tests (`apps/api/test/integration/`),
two organizations seeded through the real bootstrap and invitation flows,
every role present; plus 72 unit tests. Now 57 integration tests (a
bootstrap-concurrency regression test was added during the browser pass).

Closing steps, done:
- [x] Applied to Supabase in order: `rls-helpers.sql` (privileged), then `migrate:deploy` (2 migrations). Verified remotely: RLS enabled + forced on all 4 tables, `app_runtime` has no DELETE and may UPDATE only `status`/`accepted_by`/`accepted_at`/`revoked_at` on `invitations`. `verify-rls-isolation.mjs` 6/6 against the live database.
- [x] "Confirm email" is on (`mailer_autoconfirm: false` from the project's public Auth settings) — ADR-0013's requirement holds.
- [x] Browser pass with synthetic `@example.test` accounts (pre-confirmed via SQL so no confirmation emails were sent to non-existent addresses): see F-003 / F-013 in `docs/FEATURES.md`. It found and fixed three defects, including a real race in `/auth/bootstrap`.

Also fixed while closing: **Tailwind styles were never applied** (dev or
production) — `@tailwindcss/turbopack` had been installed in Milestone 0 but
never registered as a Turbopack loader in `next.config.ts`. Registered; the
shipped CSS now contains the utilities and the warning is gone.

Also fixed after merging: **CI had been red on `main` since Milestone 0.**
`apps/web`'s typecheck relied on Next's generated route types
(`LayoutProps`), which only exist after a local build — a clean CI checkout
never had them. The script now runs `next typegen && tsc --noEmit`, as the
Next 16 docs recommend for CI.

Synthetic test accounts covering every role and the cross-tenant cases were
kept in the Supabase project on purpose: `docs/TEST-ACCOUNTS.md`.

Follow-ups, done after the merge (2026-11-14):
- [x] `rls_auto_enable()` advisor warnings: `EXECUTE` revoked from `PUBLIC`/`anon`/`authenticated` (`packages/db/sql/harden-supabase-defaults.sql`); the `ensure_rls` trigger keeps auto-enabling RLS — verified by creating a table as `app_migrator` in a rolled-back transaction.
- [x] Sign-up asks for the full name; it reaches `profiles.full_name` on the first bootstrap (verified in the browser with a temporary account, since deleted).
- [x] CI hardened (README "CI/CD"): `main` protected by a ruleset requiring `check`, `integration` and `audit`; actions upgraded off Node 20 and SHA-pinned; least-privilege permissions; schema-drift check; translation parity check; dependency audit; Dependabot.
- [x] The drift check immediately found two indexes that existed in the database but not in `schema.prisma` — a future `migrate dev` would have dropped them. Declared.
- [x] Dependency vulnerabilities: 18 → 2 (both dev-only lint tooling). zod 3 → 4 (a DoS in input validation), vitest 2 → 4, `deepmerge-ts` overridden to 8 (via Prisma's CLI).

Still open:
- Supabase Auth **leaked-password protection** (HaveIBeenPwned check) is off — the remaining `supabase db advisors` finding. **Blocked by the plan:** it is a Pro-plan feature and the project is on the Free plan (confirmed 2026-11-14 — the dashboard refuses the toggle). It cannot be set from the CLI either (not in the CLI's config schema). Acceptable while only synthetic test accounts exist; decided at Milestone 6 (see there). **Compensating control applied:** password policy raised to min 10 chars with lower/upper/digit/symbol (was 6, no requirements) — see `docs/SECURITY.md`.
- Sign-up page heading still says "Sign in" in sign-up mode (cosmetic).
- Major dependency upgrades (TypeScript 7, Prisma 7, Express 5, vitest 5): deferred to Milestone 6 — see "Deferred dependency upgrades" below.

Dependabot's first batch (2026-11-14): merged #2 (7 minor/patch: Next 16.4.6, React 19.3.1, next-intl 4.15, typescript-eslint), #4 (`@types/supertest` 7), #6 (ESLint 10) — each through green CI on a branch up to date with `main`. Closed #3 (TypeScript 7, CI red) and #5 (`@types/node` 26 ≠ our Node 22 runtime); both ignored in `.github/dependabot.yml`. `apps/web` was also on `@types/node` 20 — aligned to 22.



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
- Verify Supabase Auth "Confirm email" is enforced in production (ADR-0013's email binding relies on it).
- Leaked-password protection: requires upgrading the Supabase project to Pro. Decide before real users: upgrade (also brings daily backups/PITR options relevant to the backup-verification item above), or document compensating controls (stronger password policy, rate limiting, MFA).
- **Evaluate and apply the deferred dependency upgrades** (table below) — each as its own PR through green CI, *before* real data is admitted, so a regression can only ever hit synthetic data. Then remove the corresponding `ignore` rules from `.github/dependabot.yml` (and the `deepmerge-ts` override once on Prisma 7).
- **Delete the synthetic `@example.test` test accounts** (`docs/TEST-ACCOUNTS.md`) and their organizations before any real data is admitted — they share a documented password.
- **DoD:** ready to onboard pilot psychologists under a signed beta agreement. **Real patient data is permitted only after this milestone's legal review is complete** — synthetic data only until then.

## Deferred dependency upgrades

**Decision (2026-11-14):** major versions of core dependencies are not
upgraded while features are being built. Each can require real code changes,
and mixing those with feature work makes regressions hard to attribute. They
are evaluated **together in Milestone 6** — not after the last milestone,
because Milestone 6 is the last point before real patient data, and a large
migration is safest while only synthetic data exists.

- **Exception — security:** if the CI `audit` job fails because a
  high/critical production vulnerability is fixed only in a new major (as
  happened with zod 3 → 4), that upgrade happens immediately, in whatever
  milestone we are in.
- Minor and patch updates are not deferred; Dependabot keeps proposing them.
- Each deferred major is ignored in `.github/dependabot.yml` (with a comment)
  so its PR isn't reopened every week; the PRs were closed with this reason.

| Package | Current | Proposed | CI on the proposal | Why deferred / what it involves | Risk if left | Closed PR |
|---|---|---|---|---|---|---|
| `prisma` + `@prisma/client` | 6.19.3 | 7.x | ❌ red | ORM major: generator/client and configuration changes; CLI and client must move together (Dependabot proposed them separately). Every milestone adds models and migrations on top, so this is the largest one. Unlocks dropping the `deepmerge-ts` override. | Medium: the cost grows with each milestone; check Prisma 6's support window at Milestone 6 | #9, #11 |
| `express` + `@types/express` | 4.22 | 5.x | ✅ green | The API framework itself: routing/path syntax, query parsing and error-handling behaviour that tests may not fully cover. Read the migration guide, then re-run the full suite + a browser pass. | Low–medium: Express 4 is in maintenance | #12 |
| `typescript` | 5.9 | 7.x | ❌ red | Typecheck and the integration suite fail; needs a planned migration. | Low: 5.x keeps working | #3 |
| `vitest` | 4.1 | 5.x | ✅ green | Dev-only (never ships). Deferred only to keep one simple rule. | Very low | #10 |
| `@types/node` | 22 | 26 | — | Not deferred for risk: types must match the runtime (`.nvmrc` = 22). Moves only when we change Node versions. | None | #5 |

### Post-MVP (sequence by real customer feedback, not by this order)
Email reminders (Resend), Stripe subscription billing, clinic
multi-professional refinements, advanced reporting, patient portal,
WhatsApp integration.

> This file is updated as part of finishing each feature — not
> retroactively at the end of a milestone.
