-- Closes a real tenant-isolation hole found by the RLS-only test in
-- packages/db/scripts/verify-rls-isolation.mjs.
--
-- The previous `memberships_select` granted visibility when
-- `organization_id = current_org_id()` -- that is, based on the organization
-- the caller DECLARED in the X-Organization-Id header. The API validates that
-- header before setting the variable, so the full request path was safe; but
-- RLS by itself was not, and RLS exists precisely to still hold when the
-- application layer has a bug (ADR-0003). A caller able to set that variable
-- to another organization could enumerate its membership rows.
--
-- Visibility now depends on membership verified by the database itself,
-- through app_private.is_active_member() -- a SECURITY DEFINER function,
-- required because a policy on `memberships` cannot query `memberships`
-- without Postgres rejecting the plan as recursive (42P17). See
-- packages/db/sql/rls-helpers.sql.
--
-- The declared-organization variable keeps its role in the *application*
-- (deciding which organization's data to ask for); it is simply no longer
-- treated as evidence of permission.

DROP POLICY IF EXISTS "memberships_select" ON "memberships";

CREATE POLICY "memberships_select" ON "memberships"
  FOR SELECT
  USING (
    -- Your own memberships, in any organization: needed before any
    -- organization is active, so the UI can offer a choice.
    user_id = (select app_private.current_user_id())
    -- Or anyone's membership in an organization you actually belong to.
    OR app_private.is_active_member(organization_id)
  );
