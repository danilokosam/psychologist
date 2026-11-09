# Psychology Practice Management SaaS

A multi-tenant SaaS platform that lets independent psychologists and small
psychology practices manage patients, appointments, clinical sessions,
clinical notes, and payments in one place, instead of spreadsheets,
calendars, and messaging apps.

> **Project status:** Milestone 0 (project foundation) implemented —
> monorepo, tooling, a working Express health check, and a Next.js app
> that calls it over HTTP. No business features (auth, patients,
> appointments, clinical data, payments) exist yet. See
> [`docs/ROADMAP.md`](docs/ROADMAP.md) for current milestone status.

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
  db/             Prisma (schema only for now -- see note below)
```
`apps/web` never imports `packages/db` or talks to Postgres directly — it
only calls `apps/api` over HTTP. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full module-internal
structure that `apps/api` will follow once features are added.

> **`packages/db` is deliberately schema-less right now.** The real schema
> (`profiles`/`organizations`/`memberships` + RLS, see `docs/DATABASE.md`)
> is tightly coupled to Supabase Auth, which Milestone 0 explicitly excluded
> to avoid building tables nothing can populate yet. Prisma is installed and
> proven to work (`pnpm --filter @psych/db run generate`); the schema itself
> is the next unit of work.

## Prerequisites

- Node.js ≥ 20.9 (`.nvmrc` pins `22`)
- [pnpm](https://pnpm.io) `11.20.0` (the repo's `packageManager` field pins
  this; `corepack use pnpm@11.20.0` will install it if you don't have it)

## Setup

```bash
pnpm install
```

Each app reads its own environment file — copy the example and fill in
real values as they become needed:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local   # Next.js convention: .env.local for local overrides
```

Milestone 0 only needs `PORT`/`NODE_ENV` (API) and `NEXT_PUBLIC_API_URL`
(web) — the example files' defaults already work together out of the box.

## Development commands

| Command | What it does |
|---|---|
| `pnpm dev` | Runs both apps in parallel (API on `:4000`, web on `:3000`) |
| `pnpm --filter @psych/api run dev` | Runs only the API (via `tsx watch`) |
| `pnpm --filter @psych/web run dev` | Runs only the frontend |
| `pnpm build` | Builds the shared types package, then both apps |
| `pnpm lint` | Lints every package |
| `pnpm typecheck` | Type-checks every package (builds `@psych/types` first) |
| `pnpm test` | Runs tests in every package |

With both apps running, `http://localhost:3000` renders a page that
fetches `http://localhost:4000/health` client-side and displays the
result — the concrete proof that the frontend talks to the backend only
over HTTP, validated against the shared `@psych/types` schema on both ends.

## Development data policy

**No real patient data until the Milestone 6 legal/DPO review is complete.**
All development and testing uses synthetic, fictional patient records and
clinical notes. See [`docs/DATA-INVENTORY.md`](docs/DATA-INVENTORY.md).
