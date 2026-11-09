-- Pure RLS/index fixes, no schema.prisma model changes -- prompted by
-- `supabase db advisors` run after the first migration (see
-- docs/SECURITY.md and CLAUDE.md for the policy design this corrects).
--
-- 1. Missing index on a foreign key column, flagged as a real performance
--    gap (not just an advisor nitpick): the memberships_self_select access
--    pattern below filters by user_id alone, with no index to support it.
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- 2. `current_setting(...)` wrapped in `(select ...)` so Postgres evaluates
--    it once per query (InitPlan) instead of once per row -- the original
--    policies called it directly, which the advisor flagged as
--    re-evaluating per row at scale.
-- 3. Two permissive SELECT policies per table (self vs org-scoped) merged
--    into one with OR -- identical access rules, but Postgres only
--    evaluates one policy per query instead of two.

DROP POLICY "profiles_self_select" ON "profiles";
DROP POLICY "profiles_orgmate_select" ON "profiles";

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

DROP POLICY "profiles_self_insert" ON "profiles";
CREATE POLICY "profiles_self_insert" ON "profiles"
  FOR INSERT
  WITH CHECK (id = (select current_setting('app.current_user_id', true)::uuid));

DROP POLICY "profiles_self_update" ON "profiles";
CREATE POLICY "profiles_self_update" ON "profiles"
  FOR UPDATE
  USING (id = (select current_setting('app.current_user_id', true)::uuid))
  WITH CHECK (id = (select current_setting('app.current_user_id', true)::uuid));

DROP POLICY "organizations_member_select" ON "organizations";
CREATE POLICY "organizations_member_select" ON "organizations"
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = (select current_setting('app.current_user_id', true)::uuid)
        AND m.status = 'active'
    )
  );

DROP POLICY "organizations_owner_update" ON "organizations";
CREATE POLICY "organizations_owner_update" ON "organizations"
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = (select current_setting('app.current_user_id', true)::uuid)
        AND m.role = 'owner' AND m.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = (select current_setting('app.current_user_id', true)::uuid)
        AND m.role = 'owner' AND m.status = 'active'
    )
  );

DROP POLICY "memberships_self_select" ON "memberships";
DROP POLICY "memberships_org_select" ON "memberships";

CREATE POLICY "memberships_select" ON "memberships"
  FOR SELECT
  USING (
    user_id = (select current_setting('app.current_user_id', true)::uuid)
    OR organization_id = (select current_setting('app.current_org_id', true)::uuid)
  );
