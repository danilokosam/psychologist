import type { Member, MemberDirectory } from '../ports/member-directory';

/** Active members of the caller's organization, e.g. to pick an appointment's professional. */
export function listMembers(
  input: { organizationId: string },
  deps: { members: MemberDirectory },
): Promise<Member[]> {
  return deps.members.listActive(input.organizationId);
}
