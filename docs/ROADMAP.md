# Roadmap

Work proceeds milestone by milestone, feature by feature within each
milestone — not in parallel across milestones. See `docs/FEATURES.md` for
the feature-level tracker and `CLAUDE.md` for the working agreement this
implies (explain before implementing, verify before marking complete).

## Status legend
`NOT STARTED` · `IN PROGRESS` · `BLOCKED` · `COMPLETED`

## Milestones

### Milestone 0 — Foundations
**Status: NOT STARTED (next up)**
Objective: a deployable skeleton with the security/tenancy model proven,
not yet any real feature.
- Monorepo scaffolding (`apps/web`, `apps/api`, `packages/db`, `packages/types`, `packages/config`).
- Supabase project (EU region), `app_migrator` / `app_runtime` DB roles provisioned.
- Prisma schema v1: `profiles`, `organizations`, `memberships` (+ composite unique constraints).
- RLS enabled + forced on those tables; `withTenantContext` helper implemented.
- Express skeleton: health check, JWT verification middleware.
- Next.js skeleton: Supabase auth wiring, next-intl setup with `en.json`/`es.json` stubs.
- Data inventory drafted (`docs/DATA-INVENTORY.md` — already done).
- CI: lint, typecheck, test on push.
- **DoD:** can sign up, create an org, see an empty dashboard, deployed to staging; startup assertion rejects a `BYPASSRLS` DB role.

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
