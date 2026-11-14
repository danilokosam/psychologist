-- Postgres extensions the schema depends on. Privileged connection only:
-- app_migrator cannot CREATE EXTENSION. Idempotent. Apply BEFORE
-- `migrate:deploy` (README "Applying database changes").
--
--   supabase db query --remote --yes --file packages/db/sql/extensions.sql
--
-- Supabase's convention is the `extensions` schema, never `public`, so the
-- extension's objects don't appear in the API-exposed schema.

CREATE SCHEMA IF NOT EXISTS extensions;

-- btree_gist (Milestone 3, ADR-0015): lets a GiST exclusion constraint
-- combine plain equality (organization_id, professional_id, patient_id --
-- uuid) with time-range overlap (tstzrange &&). That is what makes
-- double-booking impossible at the database level. The constraints resolve
-- the extension's default operator classes by type, not by search_path, so
-- the schema it lives in does not matter to them.
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
