-- Rewrites every policy to read identity through app_private.current_user_id()
-- / current_org_id() instead of casting current_setting() inline.
--
-- This fixes a real, intermittent production bug, not just style. After a
-- transaction has used `set_config('app.current_org_id', ..., true)`, that GUC
-- remains DEFINED-but-empty on the backend connection; a later transaction on
-- the same pooled connection then reads '' rather than NULL, and '' ::uuid
-- raises 22P02 "invalid input syntax for type uuid". It only reproduces once a
-- connection has already served an org-scoped request, which is why the first
-- user to sign up worked and the second one failed.
--
-- The helpers wrap the value in nullif(..., ''), so an unset or emptied
-- variable reads as NULL and the policies fail closed instead of erroring.
-- Calls stay wrapped in (select ...) so Postgres evaluates them once per
-- query rather than once per row.

-- profiles ------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select" ON "profiles";
CREATE POLICY "profiles_select" ON "profiles"
  FOR SELECT
  USING (
    id = (select app_private.current_user_id())
    OR EXISTS (
      SELECT 1 FROM memberships m1
      JOIN memberships m2 ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = profiles.id
        AND m2.user_id = (select app_private.current_user_id())
        AND m1.status = 'active' AND m2.status = 'active'
    )
  );

DROP POLICY IF EXISTS "profiles_self_insert" ON "profiles";
CREATE POLICY "profiles_self_insert" ON "profiles"
  FOR INSERT
  WITH CHECK (id = (select app_private.current_user_id()));

DROP POLICY IF EXISTS "profiles_self_update" ON "profiles";
CREATE POLICY "profiles_self_update" ON "profiles"
  FOR UPDATE
  USING (id = (select app_private.current_user_id()))
  WITH CHECK (id = (select app_private.current_user_id()));

-- organizations -------------------------------------------------------------
DROP POLICY IF EXISTS "organizations_select" ON "organizations";
CREATE POLICY "organizations_select" ON "organizations"
  FOR SELECT
  USING (
    created_by = (select app_private.current_user_id())
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = (select app_private.current_user_id())
        AND m.status = 'active'
    )
  );

DROP POLICY IF EXISTS "organizations_insert" ON "organizations";
CREATE POLICY "organizations_insert" ON "organizations"
  FOR INSERT
  WITH CHECK (created_by = (select app_private.current_user_id()));

DROP POLICY IF EXISTS "organizations_owner_update" ON "organizations";
CREATE POLICY "organizations_owner_update" ON "organizations"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = (select app_private.current_user_id())
        AND m.role = 'owner' AND m.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = (select app_private.current_user_id())
        AND m.role = 'owner' AND m.status = 'active'
    )
  );

-- memberships ---------------------------------------------------------------
DROP POLICY IF EXISTS "memberships_select" ON "memberships";
CREATE POLICY "memberships_select" ON "memberships"
  FOR SELECT
  USING (
    user_id = (select app_private.current_user_id())
    OR organization_id = (select app_private.current_org_id())
  );

DROP POLICY IF EXISTS "memberships_self_insert" ON "memberships";
CREATE POLICY "memberships_self_insert" ON "memberships"
  FOR INSERT
  WITH CHECK (
    user_id = (select app_private.current_user_id())
    AND app_private.is_organization_creator(organization_id)
  );
