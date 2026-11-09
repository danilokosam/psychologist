# API

No endpoints are implemented yet. This document defines the conventions
every endpoint must follow; the endpoint table below is filled in
incrementally, one feature at a time, as each is actually built and
verified — never documented ahead of a working, tested implementation.

## Conventions

- **Style:** resource-oriented REST (`/organizations`, `/patients`,
  `/appointments`, ...), nested only where the relationship is truly
  hierarchical (e.g. `/patients/:id/appointments`).
- **Auth:** every request (except auth endpoints themselves) requires
  `Authorization: Bearer <supabase JWT>` and `X-Organization-Id: <uuid>`.
- **Errors:** a consistent JSON shape —
  ```json
  { "error": { "code": "NOT_FOUND", "message": "..." } }
  ```
  Cross-tenant access attempts return `404`, not `403` (see
  `docs/SECURITY.md` — don't reveal that the resource exists in another org).
- **Pagination:** cursor or offset/limit (decide and record here once the
  first list endpoint is built — e.g. patients list — rather than
  speculating on a convention with no real endpoint yet).
- **Validation:** request bodies validated against the shared Zod schemas
  in `packages/types`, which are also used for frontend form validation.
- **Versioning:** not needed yet — single consumer (our own frontend),
  revisit if/when a public API or external integration appears.

## Endpoints

| Method | Path | Purpose | Status |
|---|---|---|---|
| — | — | *(none implemented yet — filled in per feature, see `docs/FEATURES.md`)* | — |

> Update this table as part of finishing a feature, not before — an
> endpoint only belongs here once it is implemented and tested.
