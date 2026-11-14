# Psychology Practice Management SaaS

A multi-tenant SaaS platform that lets independent psychologists and small
psychology practices manage patients, appointments, clinical sessions,
clinical notes, and payments in one place, instead of spreadsheets,
calendars, and messaging apps.

> **Project status:** Milestone 1 complete (organizations, invitations,
> roles, language preference) — applied to Supabase and verified in the
> browser. Milestone 0 complete — monorepo and tooling, a real
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
| [`docs/TEST-ACCOUNTS.md`](docs/TEST-ACCOUNTS.md) | Synthetic accounts in the Supabase project for manual testing (one per role, multi-org, outsider) |
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
shared/middleware/    requireAuth, resolveOrganization, requireRole, error handler
shared/authorization/ PERMISSIONS -- the role matrix from docs/SECURITY.md, as code
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
pnpm --filter @psych/db run migrate:deploy   # always AFTER rls-helpers.sql
```

See [ADR-0011](docs/decisions/0011-profiles-auth-fk-via-privileged-connection.md)
and [ADR-0012](docs/decisions/0012-rls-gates-on-verified-membership.md) for why.

### Integration tests (real Postgres, real RLS)

```bash
pnpm db:test:up          # throwaway Postgres 17 on 127.0.0.1:54329 (tmpfs, test-only credentials)
pnpm test:integration    # rebuilds the test database from scratch, then runs the suite
pnpm db:test:down
```

The suite recreates production's privilege model (`app_migrator` /
`app_runtime`, both `NOBYPASSRLS`), applies `rls-helpers.sql` and every
migration, connects the API as `app_runtime`, and verifies tokens with the
real `requireAuth` against a JWKS endpoint it serves itself. It proves
tenant isolation at both layers: through the API, and with the application
removed (RLS only). It never touches the Supabase project. CI runs it too.

### Verifying tenant isolation on the real project

```bash
cd packages/db
DATABASE_URL="<app_runtime url>" node scripts/verify-rls-isolation.mjs <userA> <userB> <orgOfA>
```

Asserts at the **database** layer — no application code in the path — that
one user cannot read, enumerate or write into another's organization. Run it
whenever a tenant policy changes; it caught a real hole once already.

## CI/CD

**CI** (`.github/workflows/ci.yml`) runs on every pull request and on `main`:

| Job | What it guarantees | Blocking |
|---|---|---|
| `check` | lint (incl. en/es translation-catalog parity), typecheck (with Next's generated route types), 72 unit tests, production build | yes |
| `integration` | 57 tests against a real Postgres built exactly like production (roles, RLS helpers, every migration): tenant isolation at the API **and** RLS-only layers, auth, invitations; then **schema drift** — `schema.prisma` must match what the migrations produce | yes |
| `audit` | `pnpm audit --prod --audit-level high` (production dependencies); a full audit is reported but not blocking | prod: yes |

**`main` is protected** by a repository ruleset: no direct pushes, no force
pushes, no deletion; every change goes through a pull request whose `check`,
`integration` and `audit` jobs pass on a branch that is up to date with
`main`. This applies to admins too. Workflow:

```bash
git switch -c feat/something        # work, commit
git push -u origin feat/something
gh pr create --fill                  # CI runs on the PR
gh pr checks --watch                 # wait for green
gh pr merge --merge --delete-branch  # only possible once all checks pass
```

### Dependabot — keeping dependencies current

**What it is.** A GitHub bot that watches this repository's dependencies
(the npm packages in `pnpm-lock.yaml` and the GitHub Actions used by CI) and,
when a newer version exists, opens a pull request that updates it. It is
configured in `.github/dependabot.yml` and runs weekly. Its PRs are authored
by `dependabot[bot]`.

**Why we use it.** Dependencies age without us touching our own code: new
vulnerabilities are published against versions we already use (that is how
zod 3 became a DoS risk for the API's input validation), and the longer
upgrades wait, the bigger and riskier they get. Dependabot turns that into a
small, regular stream of reviewable PRs. Because `main` is protected, every
one of them must pass the same `check`, `integration` and `audit` jobs as our
own code — an upgrade that breaks something simply cannot be merged (TypeScript
7 was stopped exactly this way). It also keeps the SHA-pinned GitHub Actions
up to date, which would otherwise be easy to forget.

**How it is configured.**
- npm: minor and patch updates are **grouped into one PR**; each **major**
  update gets its own PR, since majors can need code changes.
- GitHub Actions: all updates grouped.
- Deliberately ignored, with the reason in the config: `@types/node` majors
  (types must match the Node version we run — bump with `.nvmrc`) and
  `typescript` majors (TS 7 needs a planned migration).

**How to handle its PRs.**

| Situation | What to do |
|---|---|
| Minor/patch group, CI green | Merge. Read the release notes if a package matters (Next, Prisma, Supabase). |
| Major update, CI green | Read the changelog for behaviour changes CI wouldn't catch, then merge. |
| Major update, CI red | It needs a real migration: close the PR with the reason, add an `ignore` rule with a comment, and track the migration in `docs/ROADMAP.md`. |
| Merge conflict (usually `pnpm-lock.yaml`, after another PR merged) | Comment `@dependabot rebase` — it regenerates the lockfile with pnpm. Don't resolve lockfile conflicts by hand. |
| "Branch out of date" (`main` moved, no conflict) | Same `@dependabot rebase`, or `gh api -X PUT repos/<owner>/<repo>/pulls/<n>/update-branch`. Then wait for CI again. |
| Not wanted (e.g. types newer than our runtime) | Close with the reason and add an `ignore` rule, so it isn't proposed again. |

Merge one Dependabot PR at a time: each merge moves `main`, and the next PR
must be brought up to date and re-pass CI before it can merge (that's the
"up to date" requirement of the ruleset doing its job). The `audit` job's
non-blocking report shows what's still outstanding.

Actions are pinned to commit SHAs; Dependabot updates the SHA and the
version comment together.

**CD: not set up yet.** Nothing deploys automatically (no Vercel project
exists — see `docs/ROADMAP.md`). Database changes reach Supabase manually, in
order: `packages/db/sql/*.sql` with the privileged connection, then
`pnpm --filter @psych/db run migrate:deploy`. When deployment is introduced
it should be: Vercel preview per PR, production only from `main`, and
migrations applied by a protected, manually approved workflow — never from
an unreviewed branch.

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
