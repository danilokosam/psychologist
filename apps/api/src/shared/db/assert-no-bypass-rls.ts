import { prisma } from './prisma';

type RoleCheckRow = { rolname: string; rolbypassrls: boolean; rolsuper: boolean };

/**
 * Refuses to start the server if the configured database role can bypass Row
 * Level Security.
 *
 * Every tenant-isolation guarantee in docs/SECURITY.md assumes the runtime
 * role is subject to RLS. A misconfigured DATABASE_URL -- most realistically
 * Supabase's `service_role`/secret connection string, or the project's
 * `postgres` role -- would silently disable every policy at once while the
 * application still appeared to work perfectly. That is the single most
 * dangerous misconfiguration possible here, and it is invisible at runtime,
 * so it is checked loudly at startup instead.
 */
export async function assertNoBypassRls(): Promise<void> {
  const rows = await prisma.$queryRaw<RoleCheckRow[]>`
    SELECT rolname, rolbypassrls, rolsuper
    FROM pg_roles
    WHERE rolname = current_user
  `;

  const role = rows[0];
  if (!role) {
    throw new Error('Could not determine the current database role -- refusing to start.');
  }

  if (role.rolbypassrls || role.rolsuper) {
    throw new Error(
      `Database role "${role.rolname}" can bypass Row Level Security ` +
        `(rolbypassrls=${role.rolbypassrls}, rolsuper=${role.rolsuper}). ` +
        'Point DATABASE_URL at the app_runtime role instead -- never at ' +
        "Supabase's service_role/secret connection. Refusing to start.",
    );
  }

  console.log(`Database role "${role.rolname}" verified: Row Level Security applies.`);
}
