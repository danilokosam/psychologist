# CLAUDE.md — Persistent Project Context

**Read this file, and the relevant files under `/docs`, before working on
any task in this repository.** Conversation history is not a reliable
source of project context across sessions — this file and `/docs` are.
Update this file (and the relevant doc) whenever an architectural
decision or development convention changes — in the same change, not
afterward.

## Business idea and product vision

A multi-tenant SaaS platform for psychologists and psychology practices:
centralizing patient management, appointment scheduling, clinical
sessions, clinical notes, and payment tracking, so independent
psychologists spend less time on admin (spreadsheets, Google Calendar,
WhatsApp) and more time with patients.

## Target audience and business objectives

- **Primary (MVP):** independent psychologists running a solo private
  practice. Buy on their own authority; simple operational needs.
- **Future:** small practices and clinics with multiple professionals and
  administrative staff with restricted permissions — the data model and
  authorization system are designed for this from day one (see
  Multi-tenancy below), without requiring a redesign later.
- **Business model:** subscription SaaS (Starter / Professional / Clinic
  tiers), hypothesis not yet validated with real customers. Subscription
  billing (Stripe) is explicitly post-MVP.
- **Core differentiator:** built specifically for clinical-data handling
  and EU/Spain privacy expectations — not a generic CRM adapted to fit.

## MVP scope

**Must have (this is what we're building now):** auth, organizations &
memberships, patient management, appointment scheduling + conflict
prevention, clinical session recording, clinical notes (versioned,
role-restricted), payment ledger, dashboard, English/Spanish i18n.

**Explicitly postponed:** automated reminders, advanced reporting,
Stripe subscription billing, multi-professional clinic UX refinements,
patient portal, WhatsApp integration. None of these block validating the
core product.

Full feature-by-feature detail and current status: **`docs/FEATURES.md`**.

## Architecture & technology stack (summary — full detail in `docs/ARCHITECTURE.md`)

- **Modular monolith**, not microservices — no justified need at this scale.
- **Next.js (frontend) + separate Express/TypeScript REST API (backend)**,
  monorepo, shared Zod types package. See
  [ADR-0001](docs/decisions/0001-separate-express-backend.md).
- **PostgreSQL via Supabase + Prisma.** Prisma does not forward Supabase's
  `auth.uid()` — tenant/identity context is set manually per request via
  `SET LOCAL`-equivalent session variables inside a Prisma transaction.
  See [ADR-0002](docs/decisions/0002-prisma-with-manual-rls-context.md).
- **Supabase Auth**, JWT verified independently by Express (JWKS) — never
  assume Supabase-specific request context exists outside PostgREST.
  See [ADR-0008](docs/decisions/0008-supabase-auth-independent-verification.md).
- **Supabase Storage**, private buckets, backend-issued signed URLs only.
- **Deployment:** Vercel (frontend + backend, Fluid Compute), Supabase
  pooled (PgBouncer, transaction-mode) connection string.

## Repository structure

```
/apps/web      Next.js frontend
/apps/api      Express backend
/packages/db   Prisma schema, migrations
/packages/types  Shared Zod schemas (frontend + backend contracts)
/packages/config shared eslint/tsconfig
/docs          this documentation set
```
`/web` never imports `/db` directly — only talks to `/api` over HTTP.
**Not yet scaffolded** — this is Milestone 0's first task.

## Database design principles (full detail: `docs/DATABASE.md`)

- Every tenant-owned table carries `organization_id` and a compound
  `UNIQUE (id, organization_id)`.
- Every cross-table reference that could cross an organization boundary
  uses a **composite foreign key** against both columns — never a plain
  FK. Columns referencing "a user acting within an org" (professional,
  author, assignee) use a composite FK against
  `memberships (user_id, organization_id)`, not `profiles`.
  See [ADR-0004](docs/decisions/0004-composite-foreign-keys.md).
- Roles are a fixed enum (`owner`, `psychologist`, `admin_staff`) —
  **no dynamic RBAC engine** until a real customer need demonstrates one.
  See [ADR-0005](docs/decisions/0005-enum-based-roles-for-mvp.md).
- Clinical notes are append-only versioned, never edited in place.
  See [ADR-0006](docs/decisions/0006-append-only-clinical-note-versions.md).
- Data minimization is enforced per field: a field is added only when a
  specific feature justifies it (e.g. `national_id` was deliberately
  excluded from the MVP). New personal-data fields must be added to
  `docs/DATA-INVENTORY.md` in the same change.

## Multi-tenancy and organization isolation rules

- A user can belong to multiple organizations via `memberships`; the
  frontend tracks an "active organization" sent as `X-Organization-Id`.
- **Defense in depth, by design:** application-layer scoping (middleware)
  AND PostgreSQL RLS, both independently enforced — never remove one
  because "the other already covers it."
- **Session variables carry identity only** (`app.current_user_id`,
  `app.current_org_id`), never an authorization conclusion. Sensitive
  policies (clinical notes) re-derive role fresh from `memberships`
  inside the policy. See
  [ADR-0003](docs/decisions/0003-defense-in-depth-tenant-isolation.md).
- Cross-tenant access attempts return **404, not 403**.
- Full SQL patterns and the runtime-role setup (`app_runtime` vs
  `app_migrator`, `NOBYPASSRLS`, `FORCE ROW LEVEL SECURITY`): `docs/SECURITY.md`.

## Authentication and authorization requirements

See `docs/SECURITY.md` for the full per-request flow. Key invariant: the
Express API verifies JWTs itself (JWKS) and loads membership/role from
our own database — it does not trust client-reported organization or
role, and it does not rely on Supabase's `auth.uid()`. Role permissions
follow the authoritative matrix in `docs/SECURITY.md` ("Role permission
matrix" section; [ADR-0010](docs/decisions/0010-role-permission-matrix.md))
— route middleware and RLS policies must both match it; notably,
`admin_staff` has full administrative access (patients, appointments,
payments) but zero access to clinical notes, and even
`psychologist`/`owner` can only edit clinical notes they authored.

## Security and GDPR considerations

- **This architecture implements technical/organizational measures that
  support compliance (data minimization, access control, audit trails,
  tenant isolation) — it does not, by itself, constitute GDPR
  compliance, and it does not remove the psychologist's/practice's own
  legal responsibility as data controller.** Do not describe any part of
  this system, in docs or in the product, as making the product
  "GDPR-compliant" outright.
- Clinical notes and patient data are GDPR Article 9 special-category data.
- **No real patient data until the Milestone 6 legal/DPO review and DPIA
  are complete** — synthetic, fictional data only until then. This is a
  hard rule, not a guideline.
- Open legal questions (Spanish retention law, applicable Art. 9 basis,
  Supabase DPA terms) are tracked in `docs/DATA-INVENTORY.md` and must
  not be resolved by assumption in code or docs — they require
  professional legal/DPO review.

## Internationalization

English (`en`) default, Spanish (`es`) secondary, via next-intl, no URL
locale prefixes (resolved: user's `profiles.locale` → cookie →
`Accept-Language` → `en`). **Persisting the user's choice to
`profiles.locale` is Core MVP — not deferred — even though the polished
settings-page UI around it is Extended MVP** (see F-013,
`docs/FEATURES.md`); a simple, reachable toggle is enough for Core. Every new user-facing string goes into
`apps/web/messages/en.json` **and** `es.json` before a feature can be
marked COMPLETED — missing translations are a review blocker. Database
values (status codes, enums) are always language-independent; formatting
of dates/currency uses `Intl` APIs driven by locale.
See [ADR-0007](docs/decisions/0007-english-first-i18n.md).

## Coding conventions and development standards

- All code, identifiers, comments, and documentation: **English**.
- No hardcoded user-facing strings — always through the translation catalogs.
- Comments explain the **why**, not the what: non-obvious business logic,
  security-sensitive operations, multi-tenant/RLS behavior, and
  limitations/assumptions. No comments that restate what the code already says.
- Services/repositories for tenant-owned tables receive the Prisma
  transaction client (`tx`) explicitly — never import the global
  `prisma` client directly for those tables.
- Repository adapters map explicitly between Prisma rows and hand-written
  domain types in both directions — domain/application code never
  imports `@prisma/client` types, and writes never spread raw client
  input into Prisma's `data` object. `organizationId` on any write always
  comes from the trusted server-side tenant context, never from the
  request body. Full pattern: `docs/ARCHITECTURE.md`.
- The composition root (`apps/api/src/composition/container.ts`) is the
  only place allowed to import a concrete infrastructure adapter class;
  controllers call factory functions from it, never adapters directly.
  See [ADR-0009](docs/decisions/0009-module-internal-ports-and-adapters.md).
- Don't build speculative abstractions (dynamic RBAC, generic plugin
  systems, etc.) ahead of a validated need — see the ADRs for what was
  deliberately deferred and why.

## Testing requirements

Minimum for any feature touching tenant data: cross-tenant isolation
tests at **both** layers (full-stack, and RLS-only with the app-layer
check deliberately removed — see `docs/SECURITY.md`). Auth tests for
invalid/expired/tampered tokens. Integrity tests for any DB constraint
(e.g. the appointment exclusion constraints) via a direct, app-layer-
bypassing attempt. Stack: Vitest/Jest + Supertest for API integration
tests, Playwright for a small number of critical E2E flows.

## Documentation requirements

- `/docs` is maintained **during** development, not written retroactively.
- `docs/FEATURES.md` is the single source of truth for what is actually
  done — a feature is marked COMPLETED only after tests pass, acceptance
  criteria are verified, and its docs match the real implementation.
  Never mark something COMPLETED because code was written.
- New architectural decisions get a new ADR in `docs/decisions/`; existing
  ADRs are superseded, never silently edited.
- Schema changes update `docs/DATABASE.md` (and `docs/DATA-INVENTORY.md`
  if a new personal-data field is involved) in the same change.
- New/changed endpoints update `docs/API.md` in the same change.

## Current milestone and status

**Milestone 0 (Foundations) — not yet started.** Documentation and
architecture foundations (this file, `/docs`) are complete. Next step:
monorepo scaffolding, Supabase project setup, initial Prisma schema +
RLS, Express/Next.js skeletons. Full milestone breakdown and DoD per
milestone: `docs/ROADMAP.md`. **Work proceeds feature by feature, within
one milestone at a time — do not jump ahead to a later milestone's
features.**

## Locked architectural decisions — do not change without discussion first

1. Separate Express API, not a Next.js-only backend.
2. Prisma + manually propagated RLS session context via `withTenantContext`.
3. Defense-in-depth tenant isolation; session variables carry identity only, never role.
4. Composite foreign keys for every cross-organization relationship.
5. Enum-based roles for the MVP — no dynamic RBAC engine yet.
6. Append-only clinical note versioning.
7. English-first i18n, no URL locale prefixes; `profiles.locale` persistence is Core MVP.
8. Supabase Auth with independent JWT verification; `app_runtime` DB role can never bypass RLS.
9. Lightweight Ports-and-Adapters within each module; composition root uses request-scoped factory functions, never a direct adapter import in controllers.
10. The role permission matrix in `docs/SECURITY.md` — in particular, `admin_staff` never accesses clinical notes, and clinical note edits are author-restricted even among psychologists.
11. **No real patient data before the Milestone 6 legal/DPO review is complete**, and no part of this system should be described as making the product "GDPR-compliant" outright.

Full rationale and alternatives considered for each: `docs/decisions/`.

## How we work together (collaboration agreement)

For every significant implementation task: explain what we're building
and why this approach, how the request/data flows through the system,
relevant technical concepts, and how to test/verify it — before or
alongside writing code, not after a large unexplained dump of it. Work
one feature at a time; don't rush across milestones.
