import { z } from 'zod';
import { membershipRoleSchema } from './accounts';

// F-006/F-007, ADR-0015.

export const appointmentStatusSchema = z.enum(['scheduled', 'confirmed', 'completed', 'cancelled', 'no_show']);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

// What an edit may set. `cancelled` is not among them: cancelling is its own
// action, and final.
export const editableAppointmentStatusSchema = z.enum(['scheduled', 'confirmed', 'completed', 'no_show']);
export type EditableAppointmentStatus = z.infer<typeof editableAppointmentStatusSchema>;

export const appointmentModalitySchema = z.enum(['in_person', 'online']);
export type AppointmentModality = z.infer<typeof appointmentModalitySchema>;

// An instant, with an explicit offset ("2026-11-20T10:00:00+01:00" or "...Z"):
// a local time without one would be read in the server's zone, not the
// user's.
const instant = z.iso.datetime({ offset: true });

/** Longest appointment the database accepts (CHECK appointment_time_valid). */
export const APPOINTMENT_MAX_HOURS = 12;

// Strict: no organizationId, createdBy or cancelled status -- they come from
// the verified tenant context or the cancel action, never from a body.
export const createAppointmentRequestSchema = z.strictObject({
  patientId: z.uuid(),
  professionalId: z.uuid(),
  startsAt: instant,
  endsAt: instant,
  modality: appointmentModalitySchema.optional(),
  // A new appointment is either just scheduled or already confirmed; its
  // outcome (completed / no_show) is recorded afterwards.
  status: z.enum(['scheduled', 'confirmed']).optional(),
});
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;

// Partial update. No patientId: an appointment never moves to another
// patient (no column grant either). Rescheduling changes startsAt/endsAt of
// this same appointment (F-006).
export const updateAppointmentRequestSchema = z
  .strictObject({
    professionalId: z.uuid(),
    startsAt: instant,
    endsAt: instant,
    modality: appointmentModalitySchema,
    status: editableAppointmentStatusSchema,
  })
  .partial()
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdateAppointmentRequest = z.infer<typeof updateAppointmentRequestSchema>;

export const appointmentSchema = z.object({
  id: z.uuid(),
  patient: z.object({ id: z.uuid(), fullName: z.string() }),
  professional: z.object({ userId: z.uuid(), fullName: z.string().nullable() }),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  status: appointmentStatusSchema,
  modality: appointmentModalitySchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  cancelledAt: z.iso.datetime().nullable(),
});
export type Appointment = z.infer<typeof appointmentSchema>;

/** Widest window one calendar request may ask for (a month view plus margins). */
export const APPOINTMENTS_MAX_WINDOW_DAYS = 62;

// The list is bounded by a time window instead of paginated: a calendar
// always asks for "this day/week/month", and the window cap bounds the rows.
export const listAppointmentsQuerySchema = z
  .strictObject({
    from: instant,
    to: instant,
    professionalId: z.uuid().optional(),
    patientId: z.uuid().optional(),
    includeCancelled: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  })
  .refine((q) => Date.parse(q.to) > Date.parse(q.from), { message: '`to` must be after `from`' })
  .refine((q) => Date.parse(q.to) - Date.parse(q.from) <= APPOINTMENTS_MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000, {
    message: `Window longer than ${APPOINTMENTS_MAX_WINDOW_DAYS} days`,
  });
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

export const listAppointmentsResponseSchema = z.object({ appointments: z.array(appointmentSchema) });
export type ListAppointmentsResponse = z.infer<typeof listAppointmentsResponseSchema>;

export const appointmentResponseSchema = z.object({ appointment: appointmentSchema });
export type AppointmentResponse = z.infer<typeof appointmentResponseSchema>;

// GET /organizations/current/members -- who can be picked as a professional.
export const organizationMemberSchema = z.object({
  userId: z.uuid(),
  fullName: z.string().nullable(),
  role: membershipRoleSchema,
});
export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const listMembersResponseSchema = z.object({ members: z.array(organizationMemberSchema) });
export type ListMembersResponse = z.infer<typeof listMembersResponseSchema>;
