import type { MembershipRole, MembershipStatus } from '@psych/types';

// Domain types are hand-written, never imported from @prisma/client (ADR-0009).
// The repository adapter is the single place that maps database rows onto these.
export type Profile = {
  id: string;
  fullName: string | null;
  locale: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
};

export type Membership = {
  organizationId: string;
  role: MembershipRole;
  status: MembershipStatus;
  organization: Organization;
};

export type Account = {
  profile: Profile;
  memberships: Membership[];
};

/** Name used for a new solo practice when the client doesn't supply one. */
export const FALLBACK_ORGANIZATION_NAME = 'Practice';

// Unicode combining diacritical marks, left over after NFD normalization.
const COMBINING_MARKS = /[\u0300-\u036f]/g;

/**
 * Builds a URL-safe slug for an organization.
 *
 * Accents are folded rather than dropped, because the first customers are
 * Spanish-speaking: "Consulta de José Muñoz" must become
 * "consulta-de-jose-munoz", not "consulta-de-jos-muoz". The caller supplies
 * the uniqueness suffix, which keeps this a pure, testable function.
 */
export function organizationSlug(name: string, uniqueSuffix: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');

  return `${base || 'practice'}-${uniqueSuffix}`;
}
