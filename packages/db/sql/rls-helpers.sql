-- One-time setup, applied via `supabase db query --remote --yes` using the
-- privileged admin connection (runs as `postgres`), NOT via Prisma. Same
-- reason as profiles-auth-fk.sql, plus one more for the definer function
-- below: it must be OWNED by a role that can bypass RLS, and both
-- app_migrator and app_runtime are deliberately NOBYPASSRLS. `postgres` has
-- rolbypassrls = true.

-- Policies (created by Prisma migrations) call these functions, and these
-- functions read tables (also created by Prisma migrations) -- so on a fresh
-- database neither order works with default settings. Turning off body
-- validation lets this script run FIRST: the functions are created now and
-- their bodies are resolved when first executed. Bodies are still fully
-- checked at execution time; nothing is weakened. This is what makes a
-- from-scratch rebuild (and the integration-test database) reproducible:
--   1. rls-helpers.sql  2. prisma migrate deploy  3. profiles-auth-fk.sql
SET check_function_bodies = off;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
GRANT USAGE ON SCHEMA app_private TO app_runtime, app_migrator;

-- ---------------------------------------------------------------------------
-- Identity readers used by every RLS policy.
--
-- The `nullif(..., '')` is not cosmetic -- it fixes a real bug. For a custom
-- GUC that was set with `set_config(..., true)` in an earlier transaction on
-- the same backend connection, `current_setting(name, true)` returns an EMPTY
-- STRING afterwards, not NULL. Casting '' to uuid raises
-- 22P02 "invalid input syntax for type uuid". Through a connection pooler
-- that recycles backends between requests, that turns into an intermittent
-- failure that only appears once a connection has previously served an
-- org-scoped request -- which is exactly how it was found.
--
-- These are plain STABLE functions, NOT security definer: they only read
-- session state, so they need no elevated privileges.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(current_setting('app.current_user_id', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION app_private.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT nullif(current_setting('app.current_org_id', true), '')::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Recursion breaker for the memberships INSERT policy.
--
-- The `memberships` INSERT policy needs to answer "did this caller create the
-- organization they're adding themselves to?", which means reading
-- `organizations`. But the `organizations` SELECT policy reads `memberships`
-- to answer "is this caller a member?". Postgres detects the cycle at plan
-- time and aborts with 42P17 "infinite recursion detected in policy for
-- relation memberships" -- it does not matter that an OR branch would
-- short-circuit logically.
--
-- A SECURITY DEFINER function owned by a bypassing role is the standard way
-- out: the lookup runs outside RLS, so the cycle never forms. This is the one
-- legitimate use of SECURITY DEFINER here -- it is NOT papering over a
-- permission error -- and it is deliberately constrained:
--
--   * lives in a non-exposed schema (`app_private`), not `public`, so it is
--     never reachable through the Data API;
--   * EXECUTE revoked from PUBLIC, granted only to our two roles, so
--     `anon`/`authenticated` cannot call it;
--   * `SET search_path = ''` with fully-qualified references, so it cannot be
--     hijacked via a caller-controlled search_path;
--   * takes no identity argument -- it reads the caller's identity from the
--     session itself, so it cannot be asked about another user;
--   * returns a single boolean, never row data.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.is_organization_creator(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organizations o
    WHERE o.id = org_id
      AND o.created_by = nullif(current_setting('app.current_user_id', true), '')::uuid
  );
$$;

REVOKE ALL ON FUNCTION app_private.current_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.current_org_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.is_organization_creator(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app_private.current_user_id() TO app_runtime, app_migrator;
GRANT EXECUTE ON FUNCTION app_private.current_org_id() TO app_runtime, app_migrator;
GRANT EXECUTE ON FUNCTION app_private.is_organization_creator(uuid) TO app_runtime, app_migrator;

-- ---------------------------------------------------------------------------
-- Independently verified membership.
--
-- Added after the RLS-only isolation test (scripts/verify-rls-isolation.mjs)
-- caught a real hole: `memberships_select` used to grant visibility based on
-- `organization_id = current_org_id()`, i.e. on the organization the CALLER
-- CLAIMED via the X-Organization-Id header. The application layer validates
-- that claim before setting it, so the full-stack path was safe -- but RLS on
-- its own was not, which defeats the entire point of the second layer
-- (ADR-0003). A caller who set that variable to someone else's organization
-- could enumerate its memberships.
--
-- This function answers "is the caller actually an active member of this
-- organization?" from the membership rows themselves. It must be SECURITY
-- DEFINER for the same reason as is_organization_creator: a policy on
-- `memberships` cannot query `memberships` without Postgres rejecting the
-- plan as recursive (42P17). Same constraints apply -- private schema, no
-- identity argument, EXECUTE revoked from PUBLIC, pinned search_path.
--
-- Every future tenant-owned table should gate on this, AND on the declared
-- organization, rather than on the declared organization alone. See
-- docs/SECURITY.md.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.is_active_member(org_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships m
    WHERE m.organization_id = org_id
      AND m.user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
      AND m.status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION app_private.is_active_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.is_active_member(uuid) TO app_runtime, app_migrator;

-- ---------------------------------------------------------------------------
-- Invitations (ADR-0013).
--
-- current_user_email(): the caller's email, taken by the API from the
-- VERIFIED access token's `email` claim and set as `app.current_user_email` --
-- identity, exactly like current_user_id(), never an authorization
-- conclusion. Lower-cased here so comparisons match the normalized
-- invitations.email column. Same nullif('') reasoning as above.
--
-- has_pending_invitation(): "is there a live invitation for ME to this
-- organization with this role?" SECURITY DEFINER for the recursion reason
-- documented above: the memberships INSERT policy needs to read
-- `invitations`, whose own policies read `memberships`. Same constraints as
-- the other definer helpers -- private schema, identity read from the session
-- (never an argument), EXECUTE revoked from PUBLIC, pinned search_path,
-- returns a boolean only. The role is passed as text (not the enum type) so
-- this script can run before the migration that creates the type.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION app_private.current_user_email()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT lower(nullif(current_setting('app.current_user_email', true), ''));
$$;

CREATE OR REPLACE FUNCTION app_private.has_pending_invitation(org_id uuid, invited_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.invitations i
    WHERE i.organization_id = org_id
      AND i.role::text = invited_role
      AND i.status = 'pending'
      AND i.expires_at > now()
      AND i.email = lower(nullif(current_setting('app.current_user_email', true), ''))
  );
$$;

REVOKE ALL ON FUNCTION app_private.current_user_email() FROM PUBLIC;
REVOKE ALL ON FUNCTION app_private.has_pending_invitation(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.current_user_email() TO app_runtime, app_migrator;
GRANT EXECUTE ON FUNCTION app_private.has_pending_invitation(uuid, text) TO app_runtime, app_migrator;
