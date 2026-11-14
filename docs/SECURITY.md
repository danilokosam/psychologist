# Security & Authorization

Patient and clinical data is treated as GDPR Article 9 special-category
data throughout this document. See `docs/DATA-INVENTORY.md` for the data
inventory and `docs/decisions/` for the ADRs this document implements.

## Scope and legal disclaimer

**This document describes technical and organizational security
measures. It does not, by itself, constitute GDPR compliance, and it
does not transfer or remove the psychologist's or practice's own legal
responsibilities.** The organization using this product remains the data
controller and is responsible for lawful processing, patient consent,
professional record-keeping obligations, and any applicable Spanish/EU
regulatory requirements. An infrastructure provider's (Supabase or
others) own compliance posture does not automatically make this product,
or its customers, compliant. See `docs/DATA-INVENTORY.md` for the open
legal questions that require professional legal/DPO review.

**No real patient data is processed in development or testing — only
synthetic, fictional records — until that review is complete (Milestone
6, `docs/ROADMAP.md`).** This is a hard rule, not a guideline.

## Authentication flow

1. User authenticates via Supabase Auth → JWT issued.
2. Frontend attaches `Authorization: Bearer <token>` and an
   `X-Organization-Id` header (a user may belong to multiple
   organizations; the frontend tracks an "active organization") on every
   API call.
3. Express middleware verifies the JWT signature against Supabase's JWKS
   endpoint and extracts the user id (`sub`). **No Supabase-specific
   request context is assumed beyond this** — see
   [ADR-0008](decisions/0008-supabase-auth-independent-verification.md).

### Password policy (Supabase Auth)

Enforced by Supabase Auth on the real project (set 2026-11-14): **at least
10 characters, with lowercase, uppercase, a digit and a symbol**
(`password_requirements = lower_upper_letters_digits_symbols`). Email
confirmation is required (`mailer_autoconfirm: false`) and TOTP MFA is
enabled. The sign-up form mirrors the rule and translates Supabase's
`weak_password` error; the server remains the only authority. Verified by
attempting password changes on a test account: too short → rejected
(`length`), missing character classes → rejected (`characters`); existing
accounts keep signing in.

**Leaked-password protection (HaveIBeenPwned) is not available**: it is a
Pro-plan feature and the project is on Free. The stricter policy above is the
compensating control until Milestone 6 decides on an upgrade.

**How to change Auth settings on the real project safely.** Never run
`supabase config push` with the repo's `supabase/config.toml` — it describes
the *local* stack, and pushing it would turn off email confirmation and MFA
in production. Instead put a minimal `supabase/config.toml` in a scratch
directory declaring only the properties to change (undeclared ones are left
untouched), then:
```bash
supabase config diff --workdir <scratch> --remote=<ref>    # only those properties may be "declared"
supabase config push --workdir <scratch> --remote=<ref>    # without --yes first: prints the exact writes
supabase config push --workdir <scratch> --remote=<ref> --yes
```
and re-check `enable_confirmations`/MFA afterwards. Keep the repo's local
`config.toml` in sync with the policy so local and remote behave alike.

## Authorization flow (per request, in order)

1. Load the membership row for `(user_id, organization_id)`. Missing or
   `status != active` → reject with **404**, not 403 (don't reveal the
   organization exists).
2. Check role sufficiency for the route (e.g. `admin_staff` is blocked
   from any `clinical_notes` route before a query is even built).
   **Implemented:** `requireRole(PERMISSIONS[action])`
   (`apps/api/src/shared/middleware/require-role.ts`), reading the role
   `resolveOrganization` loaded from `memberships`. A verified member with
   an insufficient role gets **403 `FORBIDDEN`** — unlike step 1, this
   leaks nothing, because the caller already knows the organization exists
   and the check runs before any lookup of the specific resource.
3. Open a Prisma transaction and set tenant **identity** context — never
   an authorization conclusion:
   ```ts
   export async function withTenantContext<T>(
     req: AuthenticatedRequest,
     fn: (tx: Prisma.TransactionClient) => Promise<T>,
   ): Promise<T> {
     return prisma.$transaction(async (tx) => {
       await tx.$executeRaw`SELECT set_config('app.current_org_id', ${req.organizationId}, true)`;
       await tx.$executeRaw`SELECT set_config('app.current_user_id', ${req.userId}, true)`;
       return fn(tx);
     });
   }
   ```
   Services/repositories receive `tx` explicitly; they never import the
   global `prisma` client for tenant-owned tables (see
   [ADR-0002](decisions/0002-prisma-with-manual-rls-context.md)).
   Repositories never accept `organizationId` from client-supplied
   request data — only from this trusted context. Full repository
   mapping/trust-boundary pattern: `docs/ARCHITECTURE.md`.
4. Log the action to `audit_logs` — especially anything touching clinical
   notes.

## Role permission matrix

The fixed roles (`owner`, `psychologist`, `admin_staff` — see
[ADR-0005](decisions/0005-enum-based-roles-for-mvp.md)) map to resource
permissions as follows. This is the authoritative matrix — route-level
`requireRole(...)` middleware and RLS policies must both match it; see
[ADR-0010](decisions/0010-role-permission-matrix.md) for the full
rationale. Its code form is the `PERMISSIONS` constant
(`apps/api/src/shared/authorization/permissions.ts`); changing a row here
means changing that constant, the matching RLS policy, and the
independently transcribed table in `require-role.test.ts` in the same
change — the test fails if the code and this table disagree.

| Resource / action | Owner | Psychologist | Admin Staff |
|---|---|---|---|
| Patients — create, read, update | ✅ | ✅ | ✅ |
| Patients — delete / archive | ✅ | ❌ | ❌ |
| Appointments — create, read, update, cancel | ✅ | ✅ | ✅ |
| Clinical sessions — read (metadata: date, duration, patient, professional — no note content) | ✅ | ✅ | ✅ |
| Clinical sessions — create, update | ✅ | ✅ | ❌ |
| Clinical notes — create | ✅ | ✅ | ❌ |
| Clinical notes — read | ✅ | ✅ | ❌ |
| Clinical notes — edit (new version) | ✅ *(author only)* | ✅ *(author only)* | ❌ |
| Payments — create, read, update (mark paid/pending) | ✅ | ✅ | ✅ |
| Payments — refund | ✅ | ❌ | ❌ |
| Organization settings / membership management | ✅ | ❌ | ❌ |

Notes on the two non-obvious rows:

- **Clinical sessions are administratively readable but clinically
  writable.** `admin_staff` needs to know a session happened to process
  payment (F-010 depends on this), but only `owner`/`psychologist` can
  attest that a clinical encounter actually took place — that's a
  clinical fact, not an administrative one.
- **Clinical note edits are author-restricted, even among
  psychologists.** Any `owner`/`psychologist` in the organization can
  *read* a clinical note (deliberately not restricted further to the
  patient's assigned professional, to support shared-care visibility
  within one practice — **this is an open question to revisit if a real
  clinic customer's policy differs**, see `docs/DATA-INVENTORY.md`), but
  only the note's original author can add a new version. One
  professional silently amending another's clinical record is a
  clinical-integrity problem independent of organization boundaries.

**Open assumption, not yet resolved:** this matrix assumes `owner` is
always a practicing psychologist (true for every Core MVP customer — an
independent practice's owner *is* the psychologist). A future
non-clinical business-owner persona for the Clinic tier would need its
own role, distinct from today's `owner` — not solved now, flagged for
when a real clinic customer needs it.

## Row Level Security

**Why two layers:** application-layer scoping (step 1 above) is the
primary check, but a single missed `WHERE organizationId = ...` in future
code is a realistic failure mode. RLS is the independent second layer
that fails safe when that happens. See
[ADR-0003](decisions/0003-defense-in-depth-tenant-isolation.md).

### Identity & tenancy foundation — implemented

`profiles`, `organizations`, and `memberships` exist on the real Supabase
project and are RLS-enabled (and forced) with the policies below —
applied via `app_migrator`/Prisma Migrate, **except** the
`profiles.id → auth.users.id` foreign key, which required a different
path; see [ADR-0011](decisions/0011-profiles-auth-fk-via-privileged-connection.md).
Two policies per table were deliberately merged into one with `OR`
instead of being kept as separate permissive policies — `supabase db
advisors` flags multiple permissive policies on the same table/action as
a real performance cost (each one is evaluated per query), not just a
style nitpick. Every `current_setting(...)` call is wrapped in
`(select ...)` so Postgres evaluates it once per query (an InitPlan)
rather than once per row:

```sql
-- profiles: see your own row, or any row belonging to someone who shares
-- an active organization with you (needed to display teammate names).
CREATE POLICY "profiles_select" ON "profiles"
  FOR SELECT
  USING (
    id = (select current_setting('app.current_user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM memberships m1
      JOIN memberships m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = profiles.id
        AND m2.user_id = (select current_setting('app.current_user_id', true)::uuid)
        AND m1.status = 'active' AND m2.status = 'active'
    )
  );
-- insert/update: only on your own row (WITH CHECK, not just USING).
-- No DELETE policy -- profiles can't be deleted through the application.

-- organizations: visible to any active member; editable only by 'owner'.
CREATE POLICY "organizations_member_select" ON "organizations"
  FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = organizations.id
      AND m.user_id = (select current_setting('app.current_user_id', true)::uuid)
      AND m.status = 'active'
  ));
-- insert: WITH CHECK (true) -- identity was already verified one layer up
-- (JWT verification), before the request ever reaches the database.

-- memberships: your own memberships (any org -- needed for the org
-- switcher, before any org is "active" yet), OR anyone in your active org.
CREATE POLICY "memberships_select" ON "memberships"
  FOR SELECT
  USING (
    user_id = (select current_setting('app.current_user_id', true)::uuid)
    OR organization_id = (select current_setting('app.current_org_id', true)::uuid)
  );
```

Full migration history: `packages/db/prisma/migrations/`. The `auth_rls_initplan`
advisor still flags these policies even with the `(select ...)` wrapping applied
correctly (confirmed by inspecting the stored policy expression via `pg_policy`) —
this appears to be a linter pattern-matching limitation specific to
`current_setting()` rather than `auth.<function>()`, not an actual unresolved
performance issue; not chased further.

### Identity helpers — read this before writing any policy

Policies never cast `current_setting(...)` inline. They go through three
functions in the private `app_private` schema
(`packages/db/sql/rls-helpers.sql`), for reasons that were each found by
running code, not by review — see
[ADR-0012](decisions/0012-rls-gates-on-verified-membership.md):

| Function | Purpose |
|---|---|
| `app_private.current_user_id()` | Verified caller id. Wraps `nullif(..., '')` — a reused pooled connection reports an emptied GUC as `''`, and `''::uuid` raises 22P02 |
| `app_private.current_org_id()` | The organization the application *declared* (from `X-Organization-Id`) |
| `app_private.is_active_member(org_id)` | Whether the caller is *actually* an active member — `SECURITY DEFINER`, because a policy cannot query its own table without Postgres rejecting the plan as recursive (42P17) |
| `app_private.is_organization_creator(org_id)` | Same, for the bootstrap case |
| `app_private.current_user_email()` | The caller's email, from the **verified** token's `email` claim (`app.current_user_email`), lower-cased. Identity, like `current_user_id()` — read only by the invitation policies ([ADR-0013](decisions/0013-organization-invitations.md)) |
| `app_private.has_pending_invitation(org_id, role)` | Whether a pending, unexpired invitation exists for the caller's email to that organization with that role — `SECURITY DEFINER`, for the same recursion reason (the `memberships` INSERT policy reads `invitations`, whose policies read `memberships`) |

`rls-helpers.sql` sets `check_function_bodies = off`, so it can — and must —
run **before** the Prisma migrations on a fresh database: the migrations'
policies call these functions, and the functions read the migrations'
tables. Bodies are still checked when executed. Rollout order for any
change touching both: `rls-helpers.sql`, then `migrate:deploy`.

### Invitations — implemented ([ADR-0013](decisions/0013-organization-invitations.md))

Policies in `20261114120000_invitations/migration.sql`. In short: owners of
the declared organization (role re-derived from `memberships`) see, create
and revoke its invitations; an invitee sees only pending invitations to
their own verified email, plus the one they accepted (required — Postgres
checks the *new* row of `UPDATE … RETURNING` against the SELECT policy); the
only updates allowed are owner → `revoked` and invitee → `accepted` by
themselves. Column grants stop `app_runtime` from changing an invitation's
email, role, organization or token hash, and there is no DELETE grant. The
`memberships` INSERT policy gained its second branch: join yourself, as
`active`, with exactly the invited role, while a matching invitation is
pending. **Deployment requirement:** Supabase "Confirm email" must be on,
or the `email` claim isn't a verified address (the link token still
prevents exploitation on its own).

### Organization scoping — planned, not yet implemented

The pattern below is the design for `patients` and other tenant tables
once they exist (Milestone 2+) — not yet applied to any real table. Note
it carries **both** conditions:

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON patients
  FOR ALL
  USING (
    organization_id = (select app_private.current_org_id())
    AND app_private.is_active_member(organization_id)
  )
  WITH CHECK (
    organization_id = (select app_private.current_org_id())
    AND app_private.is_active_member(organization_id)
  );
```

The first condition stops the application from reading an organization it
didn't ask for. The second is the independent check that still holds when
the application layer has a bug — **gating on the declared organization
alone is not enough**, and was a real hole caught by the RLS-only test
before this pattern was corrected (ADR-0012).

`WITH CHECK` is required separately from `USING` — without it, nothing
stops an `UPDATE` from moving a row into a different organization.
Applied to every tenant table (`FOR ALL` covers SELECT/INSERT/UPDATE/DELETE).

### Role-aware policies on clinical data — planned, not yet implemented

Administrative staff must not read or write clinical notes **even if the
application-level role check is accidentally missed**, and even a
psychologist must not silently edit another psychologist's note. Both
properties are enforced in SQL, re-deriving authorization from
`memberships` rather than trusting a role claimed via session variable —
matching the permission matrix above.

```sql
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY memberships_org_scope ON memberships
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);
-- Not role-gated: team membership itself isn't the sensitive data here,
-- and this policy must stay non-circular so clinical tables can query it below.

ALTER TABLE clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_notes FORCE ROW LEVEL SECURITY;

-- Any active owner/psychologist in the org may READ a note.
CREATE POLICY clinical_notes_select ON clinical_notes
  FOR SELECT
  USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = clinical_notes.organization_id
        AND m.user_id = current_setting('app.current_user_id', true)::uuid
        AND m.role IN ('owner', 'psychologist') AND m.status = 'active'
    )
  );

-- Creating a note requires the clinical role AND that you name yourself as author.
CREATE POLICY clinical_notes_insert ON clinical_notes
  FOR INSERT
  WITH CHECK (
    organization_id = current_setting('app.current_org_id', true)::uuid
    AND author_id = current_setting('app.current_user_id', true)::uuid
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = clinical_notes.organization_id
        AND m.user_id = current_setting('app.current_user_id', true)::uuid
        AND m.role IN ('owner', 'psychologist') AND m.status = 'active'
    )
  );

-- Editing (advancing current_version_id) is restricted to the note's own author.
-- author_id is immutable, so checking it in WITH CHECK is sufficient regardless
-- of how broad the USING clause is.
CREATE POLICY clinical_notes_update ON clinical_notes
  FOR UPDATE
  USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (author_id = current_setting('app.current_user_id', true)::uuid);

-- No DELETE policy is defined: clinical notes can never be deleted through
-- the application, by design (append-only clinical record-keeping, ADR-0006).

ALTER TABLE clinical_note_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_note_versions FORCE ROW LEVEL SECURITY;

CREATE POLICY clinical_note_versions_select ON clinical_note_versions
  FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM clinical_notes cn WHERE cn.id = clinical_note_versions.clinical_note_id)
  ); -- visibility is inherited from clinical_notes_select, re-checked via the join

CREATE POLICY clinical_note_versions_insert ON clinical_note_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM clinical_notes cn
      WHERE cn.id = clinical_note_versions.clinical_note_id
        AND cn.author_id = current_setting('app.current_user_id', true)::uuid
    )
  );

ALTER TABLE clinical_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical_sessions FORCE ROW LEVEL SECURITY;

-- Readable by any active org member (admin_staff needs this for billing);
-- writable only by owner/psychologist (Postgres OR's permissive policies
-- together, so SELECT is governed by the broader of the two policies below).
CREATE POLICY clinical_sessions_select ON clinical_sessions
  FOR SELECT
  USING (organization_id = current_setting('app.current_org_id', true)::uuid);

CREATE POLICY clinical_sessions_write ON clinical_sessions
  FOR ALL
  USING (
    organization_id = current_setting('app.current_org_id', true)::uuid
    AND EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = clinical_sessions.organization_id
        AND m.user_id = current_setting('app.current_user_id', true)::uuid
        AND m.role IN ('owner', 'psychologist') AND m.status = 'active'
    )
  )
  WITH CHECK ( /* identical condition */ );
```

### Runtime database role — cannot bypass RLS

**Implemented** on the real project: `app_migrator` and `app_runtime`
both exist, confirmed `rolbypassrls = false` and `rolsuper = false` for
both. RLS is silently skipped for a table's owner and always for
superusers; the concrete setup that prevents this:

```sql
CREATE ROLE app_migrator LOGIN PASSWORD '...';            -- owns tables; CI/deploy only, never the app
CREATE ROLE app_runtime LOGIN PASSWORD '...' NOBYPASSRLS; -- used by the Express API for every request

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_runtime;
-- app_runtime is NOT the table owner; FORCE ROW LEVEL SECURITY is also set
-- explicitly on every tenant table as a second guarantee regardless of ownership.
```

**Supabase's `service_role` connection string must never be used as the
Express API's `DATABASE_URL`** — it is provisioned with RLS-bypass
privileges by Supabase, by design, for admin tooling. The application
asserts this at startup and refuses to run if the connected role has
`rolbypassrls` or `rolsuper` (`apps/api/src/shared/db/assert-no-bypass-rls.ts`,
implemented in Milestone 0). The API connects as `app_runtime` through the
transaction-mode pooler (port 6543).

## Private file storage

Supabase Storage buckets are private by default. Every file access goes
through a backend endpoint that performs the same membership/role check
as above, then issues a short-lived signed URL. The frontend never gets a
direct, unauthenticated bucket/object reference.

## Cross-tenant isolation testing strategy

**Implemented as an automated suite** (`apps/api/test/integration/`, run
with `pnpm db:test:up && pnpm test:integration`, and in CI). It runs against
a throwaway Postgres built exactly like production — `app_migrator` /
`app_runtime` roles (both `NOBYPASSRLS`), `rls-helpers.sql`, every Prisma
migration — with the API connected as `app_runtime`, and the **real**
`requireAuth` verifying tokens against a JWKS endpoint the suite serves
itself. The first test asserts the harness is not running as an
RLS-bypassing role, since that would make every other test pass vacuously.

- **Full-stack:** two organizations seeded through the real flows
  (bootstrap + invitations; Org A holds all three roles). Every Org A member
  gets `404` for Org B and vice versa, byte-identical to a nonexistent
  organization (`tenant-isolation.test.ts`, `invitations.test.ts`).
- **RLS-only:** connects as `app_runtime` with *no application code in
  front* and sets only the identity variables, as a buggy route would. With
  no identity, every table reads empty; an outsider claiming another
  organization sees no organization, memberships, profiles or invitations
  of it; nobody below `owner` can rename an organization; nobody can add
  someone else, delete memberships/organizations/invitations, rewrite an
  invitation's role or email, or join without a live invitation for their
  own email and that exact role. Rejections are asserted to come from the
  **policy** (`row-level security` / `permission denied`), not incidentally
  from a constraint. Verified non-vacuous by mutation: removing the email
  condition from `has_pending_invitation` makes the RLS-only suite fail
  while the full-stack one still passes — which is exactly the two layers
  being independent.
- **Auth:** expired, tampered (payload altered, signature kept), unsigned
  (`alg: none`) and wrong-issuer tokens → `401`, identical bodies, before
  any membership lookup.
- **Role test:** for clinical notes (Milestone 4) — as an `admin_staff`
  member of Org A, reading a note of Org A → `403` from `requireRole` before
  the note is looked up, and an RLS-only query returning zero rows.
- **Manual script, still useful against the real project:**
  `packages/db/scripts/verify-rls-isolation.mjs` runs the original 6
  RLS-only checks against the live Supabase database (it found the
  ADR-0012 hole the first time it ran). Re-run it after applying a
  tenant-policy migration to Supabase:
  ```bash
  cd packages/db
  DATABASE_URL="<app_runtime url>" node scripts/verify-rls-isolation.mjs <userA> <userB> <orgOfA>
  ```

**Every new tenant table adds its cases to both layers in the same change.**
