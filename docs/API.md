# API

Authentication, account bootstrap, language preference, organization
invitations, patients, appointments, clinical sessions and notes are implemented. This document defines the conventions
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
- **Pagination (decided with `GET /patients`, Milestone 2):** page-based —
  `?page=` (1-based, default 1) and `?pageSize=` (default 20, max 100); the
  response carries `page`, `pageSize` and `total`. Chosen over cursors
  because lists are per organization and small (hundreds of rows), and the UI
  wants "page X of Y". Ordering always ends in `id` so equal sort keys can't
  swap places between pages. Revisit (keyset) for any list that can grow
  unbounded, e.g. audit logs.
- **Unknown query parameters and body keys are rejected with 400** (strict
  schemas), so a client cannot believe it set something — e.g.
  `organizationId` — that the server silently ignored.
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
| GET | `/patients` | One page of the organization's patients, by name. `?q=` searches name/email/phone; `?status=active\|inactive\|archived` (absent = active + inactive) | Bearer + org; `patients.read` (any role) | Implemented (M2) |
| POST | `/patients` | Register a patient | Bearer + org; `patients.write` (any role) | Implemented (M2) |
| GET | `/patients/:id` | One patient (archived ones included) | Bearer + org; `patients.read` | Implemented (M2) |
| PATCH | `/patients/:id` | Partial update; `null` clears an optional field. `409 PATIENT_ARCHIVED` for an archived patient (any role) | Bearer + org; `patients.write` | Implemented (M2) |
| POST | `/patients/:id/archive` | Archive (there is no delete — ADR-0014). `409` if already archived | Bearer + org; `patients.archive` (owner) | Implemented (M2) |
| GET | `/organizations/current/members` | Active members (user id, name, role — no email), e.g. for the professional picker | Bearer + org; `organization.read` (any role) | Implemented (M3) |
| GET | `/appointments` | Calendar: appointments overlapping `?from=&to=` (ISO instants with offset, window ≤ 62 days), by start. Optional `professionalId`, `patientId`, `includeCancelled=true` | Bearer + org; `appointments.read` | Implemented (M3) |
| POST | `/appointments` | Book. `409 PROFESSIONAL_CONFLICT` / `PATIENT_CONFLICT` on overlap; `422 INVALID_PATIENT` / `PATIENT_ARCHIVED` / `INVALID_PROFESSIONAL`; `400 INVALID_TIME_RANGE` | Bearer + org; `appointments.write` | Implemented (M3) |
| GET | `/appointments/:id` | One appointment (cancelled included) | Bearer + org; `appointments.read` | Implemented (M3) |
| PATCH | `/appointments/:id` | Reschedule (same row), reassign, modality, status incl. outcome (`422 NOT_YET_HAPPENED` before it starts); `409 APPOINTMENT_CANCELLED` | Bearer + org; `appointments.write` | Implemented (M3) |
| POST | `/appointments/:id/cancel` | Cancel — frees the slot; final. No DELETE exists | Bearer + org; `appointments.write` | Implemented (M3) |
| GET | `/clinical-sessions` | A patient's sessions (`?patientId=`, newest first) or an appointment's (`?appointmentId=`); page-based. Metadata only | Bearer + org; `clinicalSessions.read` (any role) | Implemented (M4) |
| POST | `/clinical-sessions` | Record a session (optionally from an appointment: same patient, started, not cancelled, one per appointment — marks it completed). `422` INVALID_PATIENT / PATIENT_ARCHIVED / INVALID_PROFESSIONAL / NOT_YET_HAPPENED / INVALID_APPOINTMENT / APPOINTMENT_CANCELLED; `409 SESSION_ALREADY_RECORDED` | Bearer + org; `clinicalSessions.write` (owner, psychologist) | Implemented (M4) |
| GET | `/clinical-sessions/:id` | One session (metadata) | Bearer + org; `clinicalSessions.read` | Implemented (M4) |
| PATCH | `/clinical-sessions/:id` | Correct `startedAt` / `durationMinutes` only | Bearer + org; `clinicalSessions.write` | Implemented (M4) |
| GET | `/clinical-sessions/:id/notes` | The session's notes, current version each. **Audited per note.** `no-store` | Bearer + org; `clinicalNotes.read` (owner, psychologist) | Implemented (M4) |
| POST | `/clinical-sessions/:id/notes` | Open the caller's own note (version 1). `409 NOTE_EXISTS`; `422 PATIENT_ARCHIVED`. Audited | Bearer + org; `clinicalNotes.write` | Implemented (M4) |
| POST | `/clinical-notes/:id/versions` | Add a version: `{ content, baseVersion }`. `403 NOT_NOTE_AUTHOR`; `409 NOTE_STALE`. Audited | Bearer + org; `clinicalNotes.write`, author only | Implemented (M4) |
| GET | `/clinical-notes/:id/versions` | Full history, oldest first. Audited | Bearer + org; `clinicalNotes.read` | Implemented (M4) |
| POST | `/patients/:id/restore` | Back to `active`. `409` if not archived | Bearer + org; `patients.archive` (owner) | Implemented (M2) |

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

### Patients

Contracts: `packages/types/src/patients.ts`. Create body (only `fullName`
is required; `""` for an optional field means "no value" and is stored as
`null`; `status` may be `active` or `inactive`, never `archived`):

```json
{
  "fullName": "Paciente Sintético",
  "dateOfBirth": "1990-05-17",
  "email": "paciente@example.test",
  "phone": "+34 600 000 000",
  "emergencyContactName": "Contacto Sintético",
  "emergencyContactPhone": "+34 600 000 001",
  "status": "active"
}
```

Not representable (400 if sent): `organizationId`, `createdBy`, `id`,
`archivedAt` — they come from the verified tenant context or the owner-only
actions. Responses are `{ "patient": { … } }`, or for the list
`{ "patients": [ … ], "page": 1, "pageSize": 20, "total": 26 }`; dates of
birth are `YYYY-MM-DD` strings, timestamps ISO-8601. Unknown, malformed and
other-organization ids all return the same `404`.

### Appointments

Contracts: `packages/types/src/appointments.ts`. Lists are **bounded by a
time window instead of paginated** — a calendar always asks for a day, week
or month, and the 62-day cap bounds the rows. Times are absolute instants
with an explicit offset (`Z` or `+01:00`); a local time without one is a 400,
because the server cannot know the user's zone.

```json
{
  "patientId": "uuid",
  "professionalId": "uuid",
  "startsAt": "2030-01-07T09:00:00Z",
  "endsAt": "2030-01-07T09:50:00Z",
  "modality": "in_person",
  "status": "scheduled"
}
```

`status` on create is `scheduled` or `confirmed`; PATCH also accepts
`completed` / `no_show`, never `cancelled` (use `/cancel`). PATCH never
accepts `patientId`. Responses embed `patient: { id, fullName }` and
`professional: { userId, fullName }` (`fullName` is `null` for a
professional no longer active in the practice).

### Clinical sessions and notes

Contracts: `packages/types/src/clinical.ts`
([ADR-0016](decisions/0016-clinical-notes-immutable-rows.md)). A note is
never edited in place: `POST /clinical-notes/:id/versions` with the version
the author was looking at,

```json
{ "content": "…", "baseVersion": 3 }
```

writes version 4 — or answers `409 NOTE_STALE` if version 4 already exists
(saved from another tab/device), so no text is ever silently replaced. Note
content is stored exactly as written (not trimmed), must not be blank, and
is at most 50,000 characters. Every note response is `Cache-Control:
no-store`, and every note read or write is recorded in `audit_logs` (no
content) in the same transaction. `admin_staff` gets `403` from every note
endpoint and, independently, sees no rows under RLS.

