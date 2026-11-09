# ADR-0001: Separate Express API instead of Next.js-only backend

**Status:** Accepted
**Date:** 2026-11-09

## Context

Next.js App Router can host an entire backend via Route Handlers and Server
Actions, which would be faster to ship for an MVP (one codebase, one
deploy). This project also has an explicit learning/portfolio goal of
demonstrating REST API design, modular backend architecture, and a
uniform authorization layer — a skill set that is harder to demonstrate
convincingly through Next.js server actions.

Clinical data sensitivity also benefits from one centralized, auditable
place where every request passes through the same authentication →
membership check → role check → tenant-context → audit-log chain, which is
more naturally expressed as Express middleware than scattered across
route handlers and server actions.

## Decision

Use a separate Express + TypeScript REST API, with Next.js as a pure
frontend client that calls it over HTTP. Both live in one monorepo with a
shared `packages/types` (Zod schemas) to avoid duplicating contracts.

## Alternatives Considered

- **Next.js-only (Route Handlers/Server Actions):** faster to ship, one
  deployment, but weaker demonstration of REST API design, and
  authorization middleware is harder to apply uniformly across server
  actions and route handlers.
- **Next.js + Express, both on Vercel:** chosen variant of this decision
  for deployment (see `docs/ARCHITECTURE.md`); Express still runs as its
  own codebase/service, just not necessarily its own host.

## Consequences

- Two codebases to maintain, mitigated by a shared types package.
- CORS and auth-token forwarding between the Next.js frontend and the
  Express API must be handled explicitly.
- The API is client-agnostic from day one — a future mobile app or a
  clinic admin tool could reuse it without changes.
- If the priority ever shifts purely to "ship fastest, portfolio value is
  secondary," this decision should be revisited — it is not free.
