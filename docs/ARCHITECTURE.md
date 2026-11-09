# Architecture

## Shape: modular monolith

Organized internally by domain module (`organizations`, `patients`,
`appointments`, `clinical`, `payments`), not microservices. At this
project's realistic scale (tens to low-thousands of organizations),
microservices would add operational cost (service discovery, distributed
transactions, multiple deploy pipelines) with no corresponding benefit.

## Frontend / backend split

**Next.js (frontend) + a separate Express/TypeScript REST API
(backend).** See [ADR-0001](decisions/0001-separate-express-backend.md)
for the full trade-off against a Next.js-only backend. In short: this
project values a uniform, auditable authorization chokepoint for clinical
data, and demonstrating REST API design is an explicit portfolio goal.

Both live in one monorepo, sharing request/response contracts via
`packages/types` (Zod schemas), so the frontend and backend cannot drift
out of sync on shape without a type error.

## Stack

| Layer | Choice | Key alternative considered |
|---|---|---|
| Frontend | Next.js (App Router), TypeScript, Tailwind, shadcn/ui, next-intl | Remix |
| Backend | Express, TypeScript | Next.js Route Handlers/Server Actions only |
| Database | PostgreSQL via Supabase | MySQL, MongoDB |
| ORM | Prisma | Drizzle, raw SQL/Kysely |
| Auth | Supabase Auth, JWT verified independently in Express | Clerk |
| Storage | Supabase Storage, private buckets, signed URLs | Raw S3/R2 |
| Deployment | Vercel (frontend + backend), Fluid Compute, pooled DB connections | Railway/Fly.io for the backend |
| Email (future) | Resend | — |
| Payments (future) | Stripe | — |

## Internationalization

English (`en`) default, Spanish (`es`) secondary, via next-intl without
URL locale prefixes (resolved from user preference → cookie →
`Accept-Language` → `en` fallback). Full rationale:
[ADR-0007](decisions/0007-english-first-i18n.md).

## Deployment

Frontend and backend both on Vercel (Fluid Compute mitigates the classic
serverless/Postgres connection-storm problem), pointed at Supabase's
pooled (PgBouncer, transaction-mode) connection string. Transaction-mode
pooling is a natural fit for this project's `SET LOCAL`-per-transaction
tenant context pattern (see `docs/SECURITY.md`) — the session variable's
scope and the pooler's connection-recycling boundary are the same
boundary.

## Diagram

```
┌─────────────────────────────┐
│        Browser (User)        │
└──────────────┬───────────────┘
               │ HTTPS
               ▼
┌─────────────────────────────┐        ┌─────────────────────────┐
│   Next.js App (Vercel)       │        │   Supabase Auth           │
│   UI, routing, SSR, i18n      │◄──────►│   (hosted, managed)      │
│   supabase-js client          │  JWT   └─────────────────────────┘
└──────────────┬───────────────┘
               │ fetch (Authorization: Bearer <JWT>, X-Org-Id)
               ▼
┌───────────────────────────────────────────┐
│     Express API (Node/TS)                  │
│  ┌───────────────────────────────────────┐ │
│  │ verifyJWT → loadMembership → requireRole│ │
│  │ → setTenantContext → auditLog           │ │
│  └───────────────────────────────────────┘ │
│  Modules: orgs | patients | appointments |  │
│           clinical sessions/notes | payments│
└──────────────┬───────────────┬─────────────┘
               │ Prisma (app_runtime role, RLS enforced)
               ▼               ▼
┌─────────────────────────────┐        ┌─────────────────────────┐
│  Supabase Postgres (EU)      │        │  Supabase Storage          │
│  RLS on every tenant table    │        │  private buckets only    │
│  pooled connections (PgBouncer)│       │  backend-issued signed URLs│
└─────────────────────────────┘        └─────────────────────────┘
```

## Repository structure

```
/apps
  /web      Next.js frontend — UI, routing, calls the API, no direct DB access
  /api      Express backend — routes/controllers/services per domain module,
            middleware chain (auth, membership, role, tenant-context, audit)
/packages
  /db       Prisma schema, migrations, generated client — imported by /api only
  /types    Zod schemas (DTOs) shared by /web (form validation) and /api (request validation)
  /config   shared eslint/tsconfig
/docs       this documentation set
```

Rule: `/web` never imports `/db` directly — it only talks to `/api` over
HTTP, keeping the tenant/authorization chokepoint singular.

## Module-internal architecture (Ports and Adapters)

Each module under `/apps/api/src/modules` follows a lightweight
Hexagonal/Ports-and-Adapters discipline — see
[ADR-0009](decisions/0009-module-internal-ports-and-adapters.md) for the
full rationale against adopting the heavier, strictly-layered version of
Clean Architecture.

```
modules/patients/
  domain/patient.ts                 # entities + invariants, zero framework imports
  application/
    ports/patient-repository.ts     # interface the use case depends on
    use-cases/create-patient.ts
  infrastructure/
    persistence/prisma-patient-repository.ts   # only file here importing Prisma
  delivery/http/
    patients.routes.ts
    patients.controller.ts
```

**Dependency rule:** Delivery depends on Application; Application depends
on Domain and on its own port interfaces only; Infrastructure implements
those same port interfaces. Nothing in `domain/` or `application/` ever
imports Express, Prisma, or any third-party SDK.

### Composition root: factories, not pre-built singletons

The composition root (`apps/api/src/composition/container.ts`) is the
**only** file allowed to import a concrete adapter class (e.g.
`PrismaPatientRepository`). Controllers never import adapters directly.

Because repositories must run inside the *same* Prisma transaction that
`withTenantContext` used to set `app.current_org_id` /
`app.current_user_id` (see `docs/SECURITY.md`) — and that transaction
only exists once a request arrives — the composition root cannot hand out
ready-made repository instances at startup the way a typical DI container
does. Instead it exposes **factory functions** that take the request's
transaction client and return a module wired to it:

```ts
// composition/container.ts — the only file importing concrete adapters
export function buildPatientModule(tx: Prisma.TransactionClient) {
  const patientRepository = new PrismaPatientRepository(tx);
  return {
    createPatient: (input: CreatePatientInput, ctx: { organizationId: string }) =>
      createPatientUseCase(input, ctx, { patientRepository }),
  };
}
```

```ts
// delivery/http/patients.controller.ts — imports the composition root, never an adapter
router.post('/patients', requireRole(['owner', 'psychologist', 'admin_staff']), async (req, res) => {
  const patient = await withTenantContext(req, (tx) =>
    buildPatientModule(tx).createPatient(req.body, { organizationId: req.organizationId }),
  );
  res.status(201).json(patient);
});
```

This is a minimal, request-scoped variant of dependency injection (a
"scoped container" via a plain factory function) — deliberately not a
full DI framework, which would be unjustified ceremony at this scale. It
guarantees two things at once: (1) the controller never knows it's Prisma
underneath, and (2) a repository can never be accidentally constructed
against a connection outside the transaction that established the tenant
context — the only `tx` in scope *is* the one `withTenantContext` just
opened.

### Repository data mapping — no Prisma leakage, no raw client input

Two rules, non-negotiable for every repository adapter:

1. **Domain/application types are hand-written, never imported from
   `@prisma/client`.** Each adapter owns explicit mapping functions in
   both directions — a `toDomain(row)` for reads, and an explicit field
   list for writes. Never `data: input` spread, never returning a raw
   Prisma row as if it were a domain entity.
2. **`organizationId` is never taken from client-supplied input.** The
   request validation schema for a "create patient" call does not even
   include an `organizationId` field — it is injected by the use case
   from the trusted tenant context (`req.organizationId`, derived from
   the verified membership in `withTenantContext`, not the request body).

```ts
// infrastructure/persistence/prisma-patient-repository.ts
export class PrismaPatientRepository implements PatientRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async create(record: NewPatientRecord): Promise<Patient> {
    const row = await this.tx.patient.create({
      data: {
        organizationId: record.organizationId, // set by the use case from trusted context
        fullName: record.fullName,
        dateOfBirth: record.dateOfBirth ?? null,
        email: record.email ?? null,
        phone: record.phone ?? null,
        status: 'active',
      }, // explicit allow-list — never `data: input`
    });
    return this.toDomain(row);
  }

  private toDomain(row: Prisma.PatientGetPayload<object>): Patient {
    return { id: row.id, organizationId: row.organizationId, fullName: row.fullName, status: row.status };
  }
}
```

The RLS policy on `patients` (see `docs/SECURITY.md`) is the independent
second check that would still block a cross-organization write even if
this mapping discipline were somehow bypassed by a future bug — this is
the same defense-in-depth principle as
[ADR-0003](decisions/0003-defense-in-depth-tenant-isolation.md), applied
one layer up.

> This repository/monorepo scaffolding has not been created yet — it is
> the first task of Milestone 0. See `docs/ROADMAP.md`.
