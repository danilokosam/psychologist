-- Adds organizations.created_by, and the INSERT policies that were missing:
-- `memberships` had RLS enabled with only a SELECT policy, which means every
-- INSERT was denied -- so a new user could not have been given a membership
-- at all. Found while implementing the account bootstrap flow.
--
-- Why created_by is load-bearing and not just an audit column:
--
-- Postgres applies SELECT policies to a row returned by `INSERT ... RETURNING`
-- (which is what Prisma's `create()` always issues). The original
-- `organizations_member_select` policy requires an active membership to exist
-- for the row -- but during bootstrap the organization is inserted *before*
-- its first membership can reference it, so RETURNING would fail. The same
-- circularity blocks a membership-insert policy that needs to look up the
-- organization. Attributing the organization to its creator breaks both
-- cycles without weakening isolation: the creator is, by definition, already
-- entitled to see the organization they are in the middle of creating.

ALTER TABLE "organizations" ADD COLUMN "created_by" UUID;

-- No rows exist yet (this schema has never been written to), so backfill is
-- unnecessary and the column can go straight to NOT NULL.
ALTER TABLE "organizations" ALTER COLUMN "created_by" SET NOT NULL;

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_created_by_fkey"
  FOREIGN KEY ("created_by") REFERENCES "profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "organizations_created_by_idx" ON "organizations"("created_by");

-- Visible to an active member, OR to whoever created it.
DROP POLICY "organizations_member_select" ON "organizations";
CREATE POLICY "organizations_select" ON "organizations"
  FOR SELECT
  USING (
    created_by = (select current_setting('app.current_user_id', true)::uuid)
    OR EXISTS (
      SELECT 1 FROM memberships m
      WHERE m.organization_id = organizations.id
        AND m.user_id = (select current_setting('app.current_user_id', true)::uuid)
        AND m.status = 'active'
    )
  );

-- An organization can only be created attributed to the caller themselves.
-- The previous policy was `WITH CHECK (true)`, which allowed creating a row
-- attributed to nobody; now attribution is enforced in the database.
DROP POLICY "organizations_insert" ON "organizations";
CREATE POLICY "organizations_insert" ON "organizations"
  FOR INSERT
  WITH CHECK (created_by = (select current_setting('app.current_user_id', true)::uuid));

-- A caller may add *themselves* to an organization they created -- which is
-- exactly the bootstrap case (new user becomes owner of their own practice).
-- Inviting other people is deliberately NOT permitted yet: that is the
-- Milestone 1 invite flow and needs its own owner-gated policy. Until then
-- this fails closed rather than allowing a user to insert themselves into
-- somebody else's organization.
CREATE POLICY "memberships_self_insert" ON "memberships"
  FOR INSERT
  WITH CHECK (
    user_id = (select current_setting('app.current_user_id', true)::uuid)
    AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = memberships.organization_id
        AND o.created_by = (select current_setting('app.current_user_id', true)::uuid)
    )
  );
