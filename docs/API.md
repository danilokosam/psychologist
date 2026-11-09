# API

Authentication and account bootstrap are implemented; no clinical/business
endpoints yet. This document defines the conventions
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

| Method | Path | Purpose | Requires | Status |
|---|---|---|---|---|
| GET | `/health` | Operational liveness check — not a domain endpoint | — | Implemented (M0) |
| POST | `/auth/bootstrap` | Idempotently creates the caller's profile and, on first call, their own solo-practice organization with an `owner` membership. Safe to call on every sign-in. | Bearer token | Implemented (M0) |
| GET | `/me` | The caller's profile and the organizations they belong to | Bearer token | Implemented (M0) |
| GET | `/organizations/current` | The organization named by `X-Organization-Id`, plus the caller's role in it | Bearer token + `X-Organization-Id` | Implemented (M0) |

Everything else is *(not implemented yet — filled in per feature, see `docs/FEATURES.md`)*.

### Request/response details

`POST /auth/bootstrap` accepts an optional body; note what it does **not**
accept — no `userId`, no `organizationId`. Identity comes from the verified
token and the organization header, never from a body field, so those fields
are not representable in the schema (`packages/types/src/accounts.ts`):

```json
{ "fullName": "Ana Ruiz", "organizationName": "Consulta de Ana Ruiz" }
```

`/auth/bootstrap`, `/me` and `/organizations/current` all respond with the
account shape validated by `accountResponseSchema`:

```json
{
  "profile": { "id": "uuid", "fullName": "Ana Ruiz", "locale": "en" },
  "memberships": [
    {
      "organizationId": "uuid",
      "role": "owner",
      "status": "active",
      "organization": { "id": "uuid", "name": "Consulta de Ana Ruiz", "slug": "consulta-de-ana-ruiz-4f715a4d" }
    }
  ]
}
```

Observed status codes (verified against the real project):

| Situation | Response |
|---|---|
| No / malformed / expired / wrong-issuer token | `401 UNAUTHENTICATED` — identical message in every case, so nothing is revealed about which check failed |
| Missing or non-UUID `X-Organization-Id` | `400 BAD_REQUEST` |
| Organization the caller has no active membership in | `404 NOT_FOUND` — never 403, which would confirm it exists |
| Account not bootstrapped yet (`GET /me`) | `404 NOT_FOUND` |

> Update this table as part of finishing a feature, not before — an
> endpoint only belongs here once it is implemented and tested.
