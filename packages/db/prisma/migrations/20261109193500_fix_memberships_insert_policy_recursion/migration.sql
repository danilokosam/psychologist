-- Fixes Postgres 42P17 "infinite recursion detected in policy for relation
-- memberships", hit the first time the bootstrap flow tried to insert a
-- membership.
--
-- The previous version of this policy read `organizations` directly, whose
-- own SELECT policy reads `memberships` -- a cycle Postgres rejects at plan
-- time. The lookup now goes through app_private.is_organization_creator(),
-- a SECURITY DEFINER function owned by a bypassing role, so it resolves
-- outside RLS and the cycle never forms. See packages/db/sql/rls-helpers.sql
-- for the function and the reasoning behind its constraints.
--
-- The security property is unchanged: a caller may still only add
-- *themselves* (user_id check, evaluated against the verified session
-- identity) and only to an organization *they created*.

DROP POLICY "memberships_self_insert" ON "memberships";

CREATE POLICY "memberships_self_insert" ON "memberships"
  FOR INSERT
  WITH CHECK (
    user_id = (select current_setting('app.current_user_id', true)::uuid)
    AND app_private.is_organization_creator(organization_id)
  );
