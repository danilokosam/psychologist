import type { Tx } from '../../../shared/db/tenant-context';

/**
 * Display names for a set of users, looked up separately (not via a required
 * relation): profiles_select only shows ACTIVE co-members, so someone who has
 * since left shows as null rather than breaking the whole read.
 */
export async function namesOf(tx: Tx, userIds: string[]): Promise<Map<string, string | null>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const profiles = await tx.profile.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return new Map(profiles.map((p) => [p.id, p.fullName]));
}
