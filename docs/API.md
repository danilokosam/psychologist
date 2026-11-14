# API

Authentication, account bootstrap, language preference and organization
invitations are implemented; no clinical/business endpoints yet. This document defines the conventions
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
| PATCH | `/me` | Updates the caller's own preferences — today only `locale` (F-013) | Bearer token | Implemented (M1) |
| GET | `/organizations/current` | The organization named by `X-Organization-Id`, plus the caller's role in it | Bearer token + `X-Organization-Id`; `organization.read` (any role) | Implemented (M0) |
| POST | `/organizations/current/invitations` | Invite an email as `psychologist` or `admin_staff`; returns the one-time link token | Bearer + org; `organization.manage` (owner) | Implemented (M1) |
| GET | `/organizations/current/invitations` | Pending invitations of the active organization (never the token or its hash) | Bearer + org; `organization.manage` (owner) | Implemented (M1) |
| DELETE | `/organizations/current/invitations/:id` | Revoke a pending invitation (status change, not a delete) | Bearer + org; `organization.manage` (owner) | Implemented (M1) |
| POST | `/invitations/accept` | Join the inviting organization. No `X-Organization-Id`: the caller isn't a member of it yet | Bearer token (email claim must match the invitation) | Implemented (M1) |

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

`PATCH /me` takes exactly `{ "locale": "en" | "es" }` — the schema is
`.strict()`, so any other field (an `id`, say) is a `400`, not silently
ignored. Responds with the account shape above.

#### Invitations ([ADR-0013](decisions/0013-organization-invitations.md))

`POST /organizations/current/invitations`

```json
// request -- no organizationId, no invitedBy: both come from verified context
{ "email": "colleague@example.com", "role": "psychologist" }
// 201 response -- `token` is returned this once and never again
{
  "invitation": { "id": "uuid", "email": "colleague@example.com", "role": "psychologist",
                  "status": "pending", "expiresAt": "…", "createdAt": "…" },
  "token": "43-char base64url"
}
```

The frontend turns the token into `/invitations/accept#token=<token>` —
a URL **fragment**, never a query parameter, so it is not sent to any
server or logged. `GET` returns `{ "invitations": [ …same shape… ] }`.

`POST /invitations/accept` takes `{ "token": "…", "fullName"?: "…" }` and
responds `{ "organizationId": "uuid", "account": { …account shape… } }`. It
creates the caller's profile if needed, so an invitee who goes straight to
the link does not also get a solo practice.

| Situation | Response |
|---|---|
| Role `owner` requested, or invalid email | `400 BAD_REQUEST` |
| A pending, unexpired invitation already exists for that email | `409 CONFLICT` (an expired one is retired automatically) |
| Revoking an unknown, non-pending, malformed or other-org id | `404 NOT_FOUND` |
| Accepting with an unknown, malformed, expired, revoked or used token, or as a user whose verified email differs | `404 NOT_FOUND` — one identical body for all of them |
| Accepting while already a member | `409 CONFLICT` |

Observed status codes (verified against the real project in M0, and by the
integration suite since M1):

| Situation | Response |
|---|---|
| No / malformed / expired / wrong-issuer token | `401 UNAUTHENTICATED` — identical message in every case, so nothing is revealed about which check failed |
| Missing or non-UUID `X-Organization-Id` | `400 BAD_REQUEST` |
| Organization the caller has no active membership in | `404 NOT_FOUND` — never 403, which would confirm it exists |
| Active member whose role the route's `requireRole` doesn't allow (permission matrix, `docs/SECURITY.md`) | `403 FORBIDDEN` — returned before any lookup of the resource, so it reveals nothing about whether it exists |
| Account not bootstrapped yet (`GET /me`) | `404 NOT_FOUND` |

> Update this table as part of finishing a feature, not before — an
> endpoint only belongs here once it is implemented and tested.
