import type { Tx } from '../../../shared/db/tenant-context';
import type { Member, MemberDirectory } from '../application/ports/member-directory';

/**
 * Runs under RLS: memberships_select shows members of organizations the
 * caller actually belongs to, profiles_select shows active co-members' names.
 */
export class PrismaMemberDirectory implements MemberDirectory {
  constructor(private readonly tx: Tx) {}

  async listActive(organizationId: string): Promise<Member[]> {
    const memberships = await this.tx.membership.findMany({
      where: { organizationId, status: 'active' },
      select: { userId: true, role: true },
    });
    const profiles = await this.tx.profile.findMany({
      where: { id: { in: memberships.map((m) => m.userId) } },
      select: { id: true, fullName: true },
    });
    const names = new Map(profiles.map((p) => [p.id, p.fullName]));
    return memberships
      .map((m) => ({ userId: m.userId, role: m.role, fullName: names.get(m.userId) ?? null }))
      .sort((a, b) => (a.fullName ?? '').localeCompare(b.fullName ?? '') || a.userId.localeCompare(b.userId));
  }
}
