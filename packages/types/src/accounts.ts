import { z } from 'zod';

// Role/status vocabularies live here so the frontend, the API contract, and
// the backend's domain layer all share one definition. The Prisma schema
// necessarily has its own copy (it defines the database enums); the mapping
// between the two happens in exactly one place, the repository adapter.
export const membershipRoleSchema = z.enum(['owner', 'psychologist', 'admin_staff']);
export type MembershipRole = z.infer<typeof membershipRoleSchema>;

export const membershipStatusSchema = z.enum(['active', 'invited', 'suspended']);
export type MembershipStatus = z.infer<typeof membershipStatusSchema>;

export const supportedLocaleSchema = z.enum(['en', 'es']);
export type SupportedLocale = z.infer<typeof supportedLocaleSchema>;

// Note what is absent: no `userId`, no `organizationId`. Identity comes from
// the verified access token and the X-Organization-Id header, never from a
// request body -- so those fields are not even representable here.
export const bootstrapAccountRequestSchema = z.object({
  fullName: z.string().trim().min(1).max(200).optional(),
  organizationName: z.string().trim().min(1).max(200).optional(),
});
export type BootstrapAccountRequest = z.infer<typeof bootstrapAccountRequestSchema>;

export const profileSchema = z.object({
  id: z.uuid(),
  fullName: z.string().nullable(),
  locale: z.string(),
});
export type Profile = z.infer<typeof profileSchema>;

export const organizationSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
});
export type Organization = z.infer<typeof organizationSchema>;

export const membershipSchema = z.object({
  organizationId: z.uuid(),
  role: membershipRoleSchema,
  status: membershipStatusSchema,
  organization: organizationSchema,
});
export type Membership = z.infer<typeof membershipSchema>;

export const accountResponseSchema = z.object({
  profile: profileSchema,
  memberships: z.array(membershipSchema),
});
export type AccountResponse = z.infer<typeof accountResponseSchema>;

// PATCH /me. A strict object so a client can't smuggle extra fields (an `id`, say)
// that some future handler might be tempted to read: unknown keys are a 400.
// Whose profile is updated comes only from the verified token.
export const updateProfileRequestSchema = z.strictObject({
  locale: supportedLocaleSchema,
});
export type UpdateProfileRequest = z.infer<typeof updateProfileRequestSchema>;
