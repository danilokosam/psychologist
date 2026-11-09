# Psychology Practice Management SaaS

A multi-tenant SaaS platform that lets independent psychologists and small
psychology practices manage patients, appointments, clinical sessions,
clinical notes, and payments in one place, instead of spreadsheets,
calendars, and messaging apps.

> **Project status:** Milestone 0 complete — monorepo and tooling, a real
> Supabase project (EU), the `profiles`/`organizations`/`memberships`
> schema with Row Level Security verified by an RLS-only isolation test,
> Supabase Auth wired end to end, and an empty dashboard behind a real
> login. No clinical features (patients, appointments, sessions, notes,
> payments) exist yet — those start in Milestone 1. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Who this is for

Independent psychologists first; the data model and authorization system
are designed from day one to also support clinics with multiple
professionals and administrative staff, without requiring a redesign later.
See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for details.

## Tech stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind CSS, shadcn/ui, next-intl |
| Backend | Express, TypeScript (separate REST API) |
| Database | PostgreSQL (Supabase), Prisma ORM, Row Level Security |
| Auth | Supabase Auth, JWT verified independently in the Express API |
| Storage | Supabase Storage (private buckets, signed URLs) |

Full rationale and alternatives considered: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
and [`docs/decisions/`](docs/decisions/) (ADRs).

## Documentation map

| Document | Contents |
|---|---|
| [`CLAUDE.md`](CLAUDE.md) | Persistent project context and working agreement for AI-assisted development |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | System architecture, module responsibilities, deployment |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Schema, relationships, constraints, tenant isolation |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Auth, authorization, RLS, tenant isolation, audit strategy |
| [`docs/API.md`](docs/API.md) | API conventions and endpoint contracts (filled in as built) |
| [`docs/DATA-INVENTORY.md`](docs/DATA-INVENTORY.md) | Personal/special-category data inventory, privacy notes |
| [`docs/FEATURES.md`](docs/FEATURES.md) | Feature-by-feature implementation and verification tracker |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Milestones and progress |
| [`docs/decisions/`](docs/decisions/) | Architecture Decision Records (ADRs) |

## Project structure

```
apps/
  web/            Next.js frontend (App Router, Tailwind, next-intl)
  api/             Express backend (TypeScript, REST)
packages/
  types/          Shared Zod schemas -- the only thing web and api both import
  config/         Shared tsconfig base + ESLint config
  db/             Prisma schema, migrations, RLS helper SQL, isolation test
```

Inside `apps/api`, each domain module follows the ports-and-adapters layout
from [ADR-0009](docs/decisions/0009-module-internal-ports-and-adapters.md) —
`modules/accounts/` is the worked reference implementation:

```
modules/accounts/
  domain/              entities + pure rules (no framework imports)
  application/ports/   the interfaces the use cases depend on
  application/use-cases/
  infrastructure/      the Prisma adapter (only place importing Prisma here)
  delivery/http/       Express routes
composition/container.ts   the only file allowed to import an adapter
shared/db/            prisma client, withTenantContext, BYPASSRLS assertion
shared/middleware/    requireAuth, resolveOrganization, error handler
```
`apps/web` never imports `packages/db` or talks to Postgres directly — it
only calls `apps/api` over HTTP.

## Prerequisites

- Node.js ≥ 20.12 (`.nvmrc` pins `22`) — `--env-file-if-exists` is used to
  load `.env`, which needs 20.12+
- [pnpm](https://pnpm.io) `11.20.0` (the repo's `packageManager` field pins
  this; `corepack use pnpm@11.20.0` will install it if you don't have it)
- A Supabase project, and the Supabase CLI logged in (`supabase login`)

## Setup

```bash
pnpm install
```

Each app reads its own environment file — copy the example and fill in
real values as they become needed:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local   # Next.js convention: .env.local for local overrides
cp packages/db/.env.example packages/db/.env   # migrations only
```

The three connection identities are deliberately different, and mixing them
up is the one configuration mistake that would silently void every tenant
isolation guarantee:

| File | Role | Connection | Used by |
|---|---|---|---|
| `packages/db/.env` | `app_migrator` | pooler, **session** mode (`:5432`) | `prisma migrate` only |
| `apps/api/.env` | `app_runtime` | pooler, **transaction** mode (`:6543`, `?pgbouncer=true`) | every API request |
| `apps/web/.env.local` | — | none | browser only: API URL + Supabase publishable key |

Neither database role can bypass RLS, and **the API refuses to start if its
role can** (`assertNoBypassRls`). Supabase's direct connection host is
IPv6-only, which is why both use the pooler.

## Development commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs both apps in parallel (API on `:4000`, web on `:3000`) |
| `pnpm --filter @psych/api run dev` | Runs only the API (via `tsx watch`) |
| `pnpm --filter @psych/web run dev` | Runs only the frontend |
| `pnpm build` | Builds shared packages, then both apps |
| `pnpm lint` / `pnpm typecheck` / `pnpm test` | Across every package |
| `pnpm --filter @psych/db run migrate:deploy` | Applies pending migrations |
| `pnpm --filter @psych/db run generate` | Regenerates the Prisma client |

Database work that Prisma structurally cannot do — anything touching
Supabase's `auth` schema, and the RLS helper functions that must be owned by
an RLS-bypassing role — lives in `packages/db/sql/` and is applied with the
privileged connection, e.g.:

```bash
supabase db query --remote --yes --file packages/db/sql/rls-helpers.sql
```

See [ADR-0011](docs/decisions/0011-profiles-auth-fk-via-privileged-connection.md)
and [ADR-0012](docs/decisions/0012-rls-gates-on-verified-membership.md) for why.

### Verifying tenant isolation

```bash
cd packages/db
DATABASE_URL="<app_runtime url>" node scripts/verify-rls-isolation.mjs <userA> <userB> <orgOfA>
```

Asserts at the **database** layer — no application code in the path — that
one user cannot read, enumerate or write into another's organization. Run it
whenever a tenant policy changes; it caught a real hole once already.

## Trying it end to end

With both apps running, visit `http://localhost:3000`:

1. The home page shows live API connectivity (shared `@psych/types` schema
   validated on both ends).
2. "Sign in" → create an account with email/password (Supabase Auth).
3. You land on `/dashboard`, which calls `POST /auth/bootstrap` — creating
   your profile and your own solo practice with an `owner` membership — then
   reads the organization back through the org-scoped endpoint.
4. `/dashboard` is unreachable without a session: the Next.js proxy redirects
   to `/login` first.

## Development data policy

**No real patient data until the Milestone 6 legal/DPO review is complete.**
All development and testing uses synthetic, fictional patient records and
clinical notes. See [`docs/DATA-INVENTORY.md`](docs/DATA-INVENTORY.md).
