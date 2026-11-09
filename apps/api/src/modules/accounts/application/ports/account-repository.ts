import type { Membership, Profile } from '../../domain/account';

/**
 * What the accounts use cases need from persistence. The application layer
 * depends on this interface only -- never on Prisma (ADR-0009), which is why
 * swapping the ORM later would mean writing a new adapter, not rewriting
 * these use cases.
 */
export interface AccountRepository {
  findProfile(userId: string): Promise<Profile | null>;

  insertProfile(input: { userId: string; fullName: string | null }): Promise<Profile>;

  listMemberships(userId: string): Promise<Membership[]>;

  /**
   * Creates an organization owned by `userId` and the matching `owner`
   * membership. Both writes must land together -- the caller runs this inside
   * a transaction.
   */
  insertOrganizationWithOwner(input: {
    userId: string;
    name: string;
    slug: string;
  }): Promise<Membership>;
}
