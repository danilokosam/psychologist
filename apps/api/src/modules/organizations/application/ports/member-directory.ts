import type { MembershipRole } from '@psych/types';

export type Member = { userId: string; fullName: string | null; role: MembershipRole };

/** Read-only view of an organization's active members (for pickers). */
export interface MemberDirectory {
  listActive(organizationId: string): Promise<Member[]>;
}
