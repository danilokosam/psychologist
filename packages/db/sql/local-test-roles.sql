-- LOCAL / CI TEST DATABASES ONLY. Never run against the Supabase project.
--
-- Recreates, on a plain Postgres, the two roles the real project has (see
-- docs/SECURITY.md "Runtime database role"), so the integration tests run
-- under the same privilege model as production rather than as a superuser
-- (which would silently skip every RLS policy and make the tests worthless).
-- Passwords here are test-only and meaningless outside the throwaway
-- container.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_migrator') THEN
    CREATE ROLE app_migrator LOGIN PASSWORD 'app_migrator' NOSUPERUSER NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    CREATE ROLE app_runtime LOGIN PASSWORD 'app_runtime' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;
