import { z } from 'zod';

// F-005, ADR-0014. Every field here is personal data -- a new one needs an
// entry in docs/DATA-INVENTORY.md in the same change.

export const patientStatusSchema = z.enum(['active', 'inactive', 'archived']);
export type PatientStatus = z.infer<typeof patientStatusSchema>;

// What a create/edit may set. `archived` is not among them: archiving and
// restoring are separate owner-only actions.
export const editablePatientStatusSchema = z.enum(['active', 'inactive']);
export type EditablePatientStatus = z.infer<typeof editablePatientStatusSchema>;

// Optional text: trimmed, and an empty string means "no value" (null), so a
// cleared form field clears the column instead of storing ''.
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value === '' ? null : value))
    .nullable()
    .optional();

// Digits, spaces and the usual separators -- enough for any international
// format a practice will type, without trying to validate numbering plans.
const phone = z
  .string()
  .trim()
  .max(30)
  .regex(/^(|\+?[0-9 ().-]{3,30})$/)
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.union([z.literal(''), z.email().max(320)]))
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional();

// A calendar date, never a timestamp: a birth date has no time zone. Bounded
// below by the database CHECK and above by "today" (UTC; a one-day tolerance
// across time zones is irrelevant for a birth date).
const dateOfBirth = z
  .union([z.literal(''), z.iso.date()])
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || (value >= '1900-01-01' && value <= new Date().toISOString().slice(0, 10)), {
    message: 'Date of birth must be between 1900-01-01 and today',
  })
  .nullable()
  .optional();

const patientFields = {
  fullName: z.string().trim().min(1).max(200),
  dateOfBirth,
  email,
  phone,
  emergencyContactName: optionalText(200),
  emergencyContactPhone: phone,
};

// Strict: no organizationId, no createdBy, no status=archived -- those come
// from the verified tenant context or from the owner-only actions, never
// from a request body (docs/ARCHITECTURE.md). An unknown key is a 400, not
// silently dropped.
export const createPatientRequestSchema = z.strictObject({
  ...patientFields,
  status: editablePatientStatusSchema.optional(),
});
export type CreatePatientRequest = z.infer<typeof createPatientRequestSchema>;

// Partial update: only the keys present are changed; `null` clears an
// optional field.
export const updatePatientRequestSchema = z
  .strictObject({
    ...patientFields,
    fullName: patientFields.fullName.optional(),
    status: editablePatientStatusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Nothing to update' });
export type UpdatePatientRequest = z.infer<typeof updatePatientRequestSchema>;

export const patientSchema = z.object({
  id: z.uuid(),
  fullName: z.string(),
  dateOfBirth: z.iso.date().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  emergencyContactName: z.string().nullable(),
  emergencyContactPhone: z.string().nullable(),
  status: patientStatusSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
});
export type Patient = z.infer<typeof patientSchema>;

export const PATIENTS_MAX_PAGE_SIZE = 100;

// Query-string parameters arrive as strings, hence the coercion.
export const listPatientsQuerySchema = z.strictObject({
  q: z.string().trim().max(100).optional(),
  // Absent = the working list: active and inactive, not archived.
  status: patientStatusSchema.optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(PATIENTS_MAX_PAGE_SIZE).default(20),
});
export type ListPatientsQuery = z.infer<typeof listPatientsQuerySchema>;

export const listPatientsResponseSchema = z.object({
  patients: z.array(patientSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type ListPatientsResponse = z.infer<typeof listPatientsResponseSchema>;

export const patientResponseSchema = z.object({ patient: patientSchema });
export type PatientResponse = z.infer<typeof patientResponseSchema>;
