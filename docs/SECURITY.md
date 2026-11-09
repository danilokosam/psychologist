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

## Authorization flow (per request, in order)

1. Load the membership row for `(user_id, organization_id)`. Missing or
   `status != active` → reject with **404**, not 403 (don't reveal the
   organization exists).
2. Check role sufficiency for the route (e.g. `admin_staff` is blocked
   from any `clinical_notes` route before a query is even built).
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
rationale.

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

### Organization scoping

```sql
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE patients FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON patients
  FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true)::uuid)
  WITH CHECK (organization_id = current_setting('app.current_org_id', true)::uuid);
```
`WITH CHECK` is required separately from `USING` — without it, nothing
stops an `UPDATE` from moving a row into a different organization.
Applied to every tenant table (`FOR ALL` covers SELECT/INSERT/UPDATE/DELETE).

### Role-aware policies on clinical data

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

RLS is silently skipped for a table's owner and always for superusers.
The concrete setup that prevents this:

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
should assert this at startup: fail loudly if the connected role has
`rolbypassrls = true`.

## Private file storage

Supabase Storage buckets are private by default. Every file access goes
through a backend endpoint that performs the same membership/role check
as above, then issues a short-lived signed URL. The frontend never gets a
direct, unauthenticated bucket/object reference.

## Cross-tenant isolation testing strategy

- **Full-stack test:** seed Org A and Org B, each with a patient. As an
  authenticated Org A owner, `GET /patients/:orgBPatientId` → expect 404.
- **RLS-only test:** call the repository layer directly with the
  app-layer `organizationId` filter deliberately removed, to confirm RLS
  alone — independent of application code — still returns zero rows.
  This is the test that actually proves defense-in-depth is working, not
  just assumed.
- **Role test:** as an `admin_staff` member of Org A, attempt to read a
  `clinical_notes` row belonging to a patient in Org A (same org, wrong
  role) → expect 404 at the app layer, and a direct RLS-only query to
  return zero rows.
- **Auth test:** invalid, expired, and tampered JWTs → rejected before
  any membership lookup runs.

> None of the above is implemented yet. This document describes the
> required behavior; `docs/FEATURES.md` tracks the actual implementation
> and test status per feature.
