-- Privileged, idempotent hardening of objects Supabase creates in a new
-- project (not by this repo). Apply with the privileged connection:
--   supabase db query --remote --yes --file packages/db/sql/harden-supabase-defaults.sql
--
-- public.rls_auto_enable() backs Supabase's `ensure_rls` event trigger, which
-- enables RLS on every new table in `public`. That behaviour is a useful
-- safety net and is kept. The problem flagged by `supabase db advisors`
-- (lints 0028/0029) is only that the function is SECURITY DEFINER and
-- EXECUTE-able by `anon`/`authenticated` (and PUBLIC), i.e. reachable as
-- /rest/v1/rpc/rls_auto_enable. Nothing legitimate ever calls it directly:
-- Postgres does not check EXECUTE when an event trigger fires it, so revoking
-- changes nothing for DDL (verified against the real project by creating a
-- table as app_migrator in a rolled-back transaction: RLS still auto-enabled).
DO $$
BEGIN
  IF to_regprocedure('public.rls_auto_enable()') IS NOT NULL THEN
    REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;
  END IF;
END
$$;
