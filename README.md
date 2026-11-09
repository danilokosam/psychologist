# Psychology Practice Management SaaS

A multi-tenant SaaS platform that lets independent psychologists and small
psychology practices manage patients, appointments, clinical sessions,
clinical notes, and payments in one place, instead of spreadsheets,
calendars, and messaging apps.

> **Project status:** pre-implementation. Documentation and architecture
> foundations are in place; application code has not been written yet.
> See [`docs/ROADMAP.md`](docs/ROADMAP.md) for current milestone status.

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

## Setup instructions

Not yet available — repository/monorepo scaffolding happens in Milestone 0.
This section will be filled in with real install/run/test commands once
that scaffolding exists. See [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Development data policy

**No real patient data until the Milestone 6 legal/DPO review is complete.**
All development and testing uses synthetic, fictional patient records and
clinical notes. See [`docs/DATA-INVENTORY.md`](docs/DATA-INVENTORY.md).
