import { z } from 'zod';
import { accountResponseSchema } from './accounts';

// ADR-0013. 'owner' is deliberately not invitable -- ownership transfer is a
// separate, higher-stakes operation that is not built.
export const invitableRoleSchema = z.enum(['psychologist', 'admin_staff']);
export type InvitableRole = z.infer<typeof invitableRoleSchema>;

export const invitationStatusSchema = z.enum(['pending', 'accepted', 'revoked']);
export type InvitationStatus = z.infer<typeof invitationStatusSchema>;

// No organizationId (comes from X-Organization-Id, verified by membership)
// and no invitedBy (comes from the verified token).
export const createInvitationRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  role: invitableRoleSchema,
});
export type CreateInvitationRequest = z.infer<typeof createInvitationRequestSchema>;

// What an owner sees. Never includes the token or its hash.
export const invitationSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  role: invitableRoleSchema,
  status: invitationStatusSchema,
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type Invitation = z.infer<typeof invitationSchema>;

// The token is returned exactly once, here; only its hash is stored.
export const createInvitationResponseSchema = z.object({
  invitation: invitationSchema,
  token: z.string(),
});
export type CreateInvitationResponse = z.infer<typeof createInvitationResponseSchema>;

export const listInvitationsResponseSchema = z.object({
  invitations: z.array(invitationSchema),
});
export type ListInvitationsResponse = z.infer<typeof listInvitationsResponseSchema>;

export const acceptInvitationRequestSchema = z.object({
  // base64url of 32 random bytes = 43 chars; bounded so arbitrary input is
  // rejected before any hashing or lookup.
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  fullName: z.string().trim().min(1).max(200).optional(),
});
export type AcceptInvitationRequest = z.infer<typeof acceptInvitationRequestSchema>;

export const acceptInvitationResponseSchema = z.object({
  organizationId: z.string().uuid(),
  account: accountResponseSchema,
});
export type AcceptInvitationResponse = z.infer<typeof acceptInvitationResponseSchema>;
