-- F-013: profiles.locale becomes user-writable (PATCH /me), so the set of
-- valid values is enforced by the database too, not only by the API's Zod
-- schema -- the same defense-in-depth stance as everywhere else. Must match
-- supportedLocaleSchema in packages/types and SUPPORTED_LOCALES in apps/web.
--
-- No schema.prisma change: Prisma has no syntax for CHECK constraints.
-- Every existing row holds the column default 'en', so this cannot fail on
-- existing data.
ALTER TABLE "profiles" ADD CONSTRAINT "profiles_locale_supported"
  CHECK (locale IN ('en', 'es'));
