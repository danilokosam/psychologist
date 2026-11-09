-- One-time setup, applied via `supabase db query --remote --yes` using the
-- privileged admin connection (runs as `postgres`), NOT via Prisma/
-- app_migrator. Links profiles.id to a real Supabase Auth user at the
-- database level, so a profile can never exist without a corresponding
-- auth.users row.
--
-- Why this can't be part of the Prisma migration: app_migrator cannot be
-- granted any privilege on Supabase's `auth` schema -- confirmed
-- empirically: `GRANT USAGE ON SCHEMA auth TO app_migrator` reports
-- success but `has_schema_privilege('app_migrator', 'auth', 'USAGE')`
-- still returns false immediately afterward, in the same session. This
-- appears to be a deliberate Supabase platform safeguard protecting the
-- `auth` schema from customer-created roles, not an ordinary ACL you can
-- grant your way around.
--
-- `postgres` itself DOES have direct usage rights on auth.users (it can
-- reference it directly), but does not own the `profiles` table (Prisma's
-- app_migrator does), and ALTER TABLE ADD CONSTRAINT requires ownership.
-- The fix: grant `postgres` inherited membership in `app_migrator`.
-- PostgreSQL's ownership checks for ALTER/DROP accept inherited role
-- membership, not just literal current_user equality or an explicit
-- SET ROLE -- so `postgres` can satisfy the "owner of profiles" check via
-- that membership while still using its own direct auth.users privilege,
-- in the same statement.
GRANT app_migrator TO postgres;

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
