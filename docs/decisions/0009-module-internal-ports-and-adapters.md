# ADR-0009: Lightweight Ports-and-Adapters within each module

**Status:** Accepted
**Date:** 2026-11-09

## Context

The project needs business logic that doesn't depend on which ORM, auth
provider, or email/storage vendor is behind it — explicitly so Prisma,
Supabase Auth, or Resend/Storage can be replaced later without rewriting
business rules. Full Clean Architecture (strict Entity/Use-Case ring
separation, dedicated DTOs at every boundary) would deliver that same
independence but with more ceremony than a 13-feature MVP built by one
developer warrants.

A separate, related problem: a naive composition root (wiring concrete
adapters into use cases once at startup, as a typical DI container does)
doesn't fit this project's repositories, which must run inside the
specific Prisma transaction that `withTenantContext` opens per request
(see [ADR-0002](0002-prisma-with-manual-rls-context.md)) — that
transaction doesn't exist until a request arrives.

## Decision

Each module (`apps/api/src/modules/<name>`) is organized into four thin
layers: `domain` (entities/invariants, zero framework imports),
`application` (use cases + the port interfaces they depend on),
`infrastructure` (adapters implementing those ports — the only place
importing Prisma/Supabase/Resend SDKs), and `delivery` (Express
routes/controllers). Dependency direction: delivery → application →
domain, with infrastructure implementing application's port interfaces
(dependency inversion).

The composition root (`apps/api/src/composition/container.ts`) is the
only file allowed to import a concrete adapter class. Because
repositories need a request-scoped transaction, the composition root
exposes **factory functions** — e.g. `buildPatientModule(tx)` — rather
than pre-built singletons; controllers call these factories inside the
`withTenantContext` callback, never importing an adapter directly.

Repository adapters map explicitly between Prisma rows and hand-written
domain types in both directions; domain/application code never imports
`@prisma/client` types, and writes never spread raw client input into
Prisma's `data` object — `organizationId` always comes from the trusted
tenant context, never the request body. Full code pattern:
`docs/ARCHITECTURE.md`.

## Alternatives Considered

- **Full Clean Architecture** (strict Entity/Use-Case rings, DTOs at
  every boundary): rejected as more ceremony than this project's scale
  justifies.
- **A full DI framework** (e.g. a container library with decorators):
  rejected — a plain factory function achieves the same request-scoping
  need without an extra dependency or learning curve.
- **Controllers instantiating adapters directly** (what an earlier,
  informal example in this project's discussion did): rejected — it
  breaks the "composition root is the only place that knows concrete
  infrastructure" guarantee this ADR exists to establish.

## Consequences

- A feature touches roughly five files instead of one controller
  function calling Prisma directly — an accepted cost for the
  swappability and testability gained.
- Trivial CRUD modules with no real business rule may collapse
  domain+application into one smaller file rather than forcing the full
  five-file shape — this is a judgment call, not a violation of the
  pattern.
