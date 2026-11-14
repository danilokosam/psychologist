# Synthetic test accounts (Supabase project)

Fictitious users that live in the **real Supabase project**
(`eddhihxizeeanysekuzs`), kept on purpose for manual and browser testing.
They were created during the Milestone 1 browser pass (2026-11-14) and
together cover every role and the cross-tenant cases.

- **All synthetic.** `@example.test` is a reserved, non-deliverable domain;
  no real person is behind any of these. Only synthetic data may ever be
  attached to them (see the data policy in `CLAUDE.md`).
- **Password:** one shared password, kept **out of git** in the gitignored
  file `.env.test-accounts` at the repo root (`TEST_ACCOUNTS_PASSWORD`).
  If that file is lost, reset it (privileged connection):
  ```bash
  supabase db query --remote --yes "update auth.users set encrypted_password = extensions.crypt('<new password>', extensions.gen_salt('bf')) where email like '%@example.test'"
  ```
- **Created pre-confirmed by SQL** (`auth.users` + `auth.identities`), not via
  sign-up: the project requires email confirmation, and sign-ups to
  non-existent addresses would send confirmation emails that bounce (that
  hurts the project's email reputation, and the default SMTP is rate-limited
  to a few emails per hour). Sign-in works normally through the UI.
- **⚠️ Must be deleted before Milestone 6** (the first real patient data). A
  shared, documented password on owner accounts is fine for a development
  project and unacceptable once real data exists. Tracked in
  `docs/ROADMAP.md`, Milestone 6.

## Accounts

| Email | Name | Persona | Organization → role | Profile locale |
|---|---|---|---|---|
| `ana.owner@example.test` | Ana Owner (TEST) | Owner of the main test practice | **Consulta Ana (TEST)** → `owner` | `es` |
| `bruno.psych@example.test` | Bruno Psych (TEST) | Clinician invited into Ana's practice | Consulta Ana (TEST) → `psychologist` | `en` |
| `carla.staff@example.test` | Carla Staff (TEST) | Administrative staff in Ana's practice | Consulta Ana (TEST) → `admin_staff` | `en` |
| `diego.owner@example.test` | Diego Owner (TEST) | **Multi-organization user** (F-003) | **Consulta Diego (TEST)** → `owner`; Consulta Ana (TEST) → `admin_staff` | `en` |
| `mallory@example.test` | Mallory Outsider (TEST) | **The outsider / attacker** for cross-tenant tests: belongs to nothing of Ana's | **Consulta Mallory (TEST)** → `owner` | `en` |

## Organizations

| Organization | id | Members |
|---|---|---|
| Consulta Ana (TEST) | `080ef33e-dd49-4d87-9e30-89996b49b4fc` | Ana (owner), Bruno (psychologist), Carla (admin_staff), Diego (admin_staff) |
| Consulta Diego (TEST) | `cd766dad-5b31-4a18-bdf7-d87653be674c` | Diego (owner) |
| Consulta Mallory (TEST) | `6ec11306-3386-4b1e-abdd-233b0ed118d2` | Mallory (owner) |

User ids, for scripts such as `packages/db/scripts/verify-rls-isolation.mjs`:

| Email | user id |
|---|---|
| ana.owner@example.test | `6a58b6e4-2831-49b1-a699-1d36780163df` |
| bruno.psych@example.test | `066b2045-3d5f-45a8-b670-f3a0d6db784d` |
| carla.staff@example.test | `063323f2-23d4-4373-8da0-f158c7162d8f` |
| diego.owner@example.test | `3ca12da6-ea88-419b-893f-80fefd898a0f` |
| mallory@example.test | `f644bddc-4afc-438a-9207-1fb51ae40ea5` |

Example — the RLS-only isolation check with Ana's practice as the target and
Mallory as the stranger:

```bash
cd packages/db
DATABASE_URL="<app_runtime url>" node scripts/verify-rls-isolation.mjs \
  6a58b6e4-2831-49b1-a699-1d36780163df f644bddc-4afc-438a-9207-1fb51ae40ea5 \
  080ef33e-dd49-4d87-9e30-89996b49b4fc
```

## What each account is good for

- **Role matrix** (`docs/SECURITY.md`): inside Consulta Ana, Ana / Bruno /
  Carla are the three roles. Anything `owner`-only (team management, and in
  later milestones patient deletion, refunds) → Ana allowed, Bruno and Carla
  `403`. Anything clinical (notes, Milestone 4) → Carla must be refused.
- **Cross-tenant isolation:** Mallory against any of Ana's resources must get
  `404`, never `403`.
- **Organization switcher:** Diego has two organizations with different roles
  (owner in his own, admin_staff in Ana's).
- **Language:** Ana's profile is Spanish, everyone else's English — signing
  in as Ana from a fresh browser must switch the UI to Spanish.

## Invitation history (state as left)

In Consulta Ana: invitations to Bruno, Carla and Diego are `accepted`; one to
`decoy@example.test` is `revoked`. There are no pending invitations, so the
invite flow can be exercised again from scratch by inviting any new
`@example.test` address (accept it by creating that account the same way as
above, or by inviting an existing test account into a practice it doesn't
belong to yet — e.g. Mallory into Consulta Diego).

## Synthetic patients (Milestone 2)

| Patient | Organization | State as left |
|---|---|---|
| José Sintético Pérez (TEST) — id `44f62aef-b0f0-4982-9ec4-facaf09bc253` | Consulta Ana (TEST) | `inactive`; has been archived and restored once (browser pass 2026-11-14) |
| Lucía Sintética Gómez (TEST) — id `b3e49c2c-3b98-4687-a41d-b77a987056c8` | Consulta Ana (TEST) | `active` (Milestone 3 browser pass) |

### In Consulta Mallory (TEST) — demo data for UI work

Patients Marta Ficticia Ruiz (active), Pablo Inventado Sanz (active), Irene
Sintética Mora (inactive), each with one appointment in the week of
2026-11-16 (confirmed / online-scheduled / scheduled). Created during the UI
refresh to see every screen with data. Mallory is still the outsider for
Ana's practice — this data is hers alone.

## Synthetic appointments (Milestone 3)

All in Consulta Ana (TEST), Monday 2026-11-16 / Tuesday 2026-11-17 (times
shown in Madrid time):

| Appointment | State as left |
|---|---|
| José with Bruno, Mon 16 10:00–10:50 — id `f962db1b-0e46-4853-b0fe-9ed894e2b0e1` | `scheduled` — the slot that refused Lucía at 10:30 (professional conflict) and José with Ana at 10:15 (patient conflict) |
| Lucía, Mon 16 10:00 with Ana (rescheduled from 10:50 with Bruno) | `cancelled` |
| Lucía with Bruno, Tue 17 10:00 (booked and cancelled by Carla) | `cancelled` |

Good for: conflict checks against José's slot; Carla gets `422
INVALID_PROFESSIONAL` when she puts herself as the professional; Mallory gets
`404` for any of these and `422 INVALID_PATIENT` booking José into her own
practice. Once 2026-11-16 has passed, José's appointment can be marked
`completed` / `no_show` (before that: `422 NOT_YET_HAPPENED`).

Good for: Carla (`admin_staff`) can edit it but gets `403` on archive/restore;
Mallory gets `404` for it under any organization header; Ana can archive
and restore it. Add more patients through the UI or `POST /patients` — always
fictional, always with "(TEST)" in the name.

> Keep this file in sync if accounts, roles, organizations or synthetic
> patients change.
