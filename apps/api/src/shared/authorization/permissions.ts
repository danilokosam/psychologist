import type { MembershipRole } from '@psych/types';

/**
 * The role permission matrix from docs/SECURITY.md (ADR-0010), written down
 * once as data so routes reference an action rather than re-typing role
 * lists by hand -- a hand-typed list is exactly how one route would silently
 * drift from the matrix.
 *
 * This is deliberately a static constant, not an RBAC engine (ADR-0005):
 * changing it is a code change reviewed against SECURITY.md, and the RLS
 * policies must be changed to match in the same change.
 *
 * Covers role-level rules only. Resource-level rules -- notably "only the
 * note's original author may add a new clinical note version" -- cannot be
 * decided from the role alone; they are enforced by the use case and,
 * independently, by RLS once those tables exist (Milestone 4).
 */
const ALL_ROLES = ['owner', 'psychologist', 'admin_staff'] as const satisfies readonly MembershipRole[];
const CLINICAL_ROLES = ['owner', 'psychologist'] as const satisfies readonly MembershipRole[];
const OWNER_ONLY = ['owner'] as const satisfies readonly MembershipRole[];

export const PERMISSIONS = {
  // Any active member may see the organization they are working in.
  'organization.read': ALL_ROLES,
  // Organization settings and membership management (invites, role changes).
  'organization.manage': OWNER_ONLY,

  'patients.read': ALL_ROLES,
  'patients.write': ALL_ROLES, // create + update
  'patients.delete': OWNER_ONLY, // delete / archive

  'appointments.read': ALL_ROLES,
  'appointments.write': ALL_ROLES, // create, update, cancel

  // Administratively readable (admin_staff needs it to bill), clinically
  // writable: only a clinician can attest that a session took place.
  'clinicalSessions.read': ALL_ROLES,
  'clinicalSessions.write': CLINICAL_ROLES,

  // admin_staff never reaches clinical notes, under any circumstance.
  'clinicalNotes.read': CLINICAL_ROLES,
  'clinicalNotes.write': CLINICAL_ROLES, // create + new version (author-only, see above)

  'payments.read': ALL_ROLES,
  'payments.write': ALL_ROLES, // create, mark paid/pending
  'payments.refund': OWNER_ONLY,
} as const satisfies Record<string, readonly MembershipRole[]>;

export type Permission = keyof typeof PERMISSIONS;
