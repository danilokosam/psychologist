import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  appointmentResponseSchema,
  createAppointmentRequestSchema,
  listAppointmentsQuerySchema,
  listAppointmentsResponseSchema,
  updateAppointmentRequestSchema,
} from '@psych/types';
import { buildAppointmentsModule } from '../../../../composition/container';
import { withTenantContext } from '../../../../shared/db/tenant-context';
import { PERMISSIONS, type Permission } from '../../../../shared/authorization/permissions';
import { requireAuth } from '../../../../shared/middleware/require-auth';
import { resolveOrganization } from '../../../../shared/middleware/resolve-organization';
import { requireRole } from '../../../../shared/middleware/require-role';
import { AppError } from '../../../../shared/middleware/error-handler';
import { asyncHandler } from '../../../../shared/http/async-handler';
import { tenantContext } from '../../../../shared/http/request-context';
import type { Appointment, AppointmentChanges } from '../../domain/appointment';
import type { ConflictSide } from '../../application/ports/appointment-repository';

export const appointmentsRouter = Router();

const guard = (permission: Permission) =>
  [requireAuth, resolveOrganization, requireRole(PERMISSIONS[permission])] as const;

const notFound = () => new AppError(404, 'Appointment not found', 'NOT_FOUND');

/** Malformed, unknown and other-organization ids are indistinguishable: 404. */
function appointmentIdParam(req: Request): string {
  const id = z.uuid().safeParse(req.params.appointmentId);
  if (!id.success) throw notFound();
  return id.data;
}

// Which collision, so the UI can say "the professional is busy" vs "the
// patient already has an appointment then". Both are within the caller's own
// organization only (ADR-0015), so naming the side reveals nothing new.
const conflict = (side: ConflictSide) =>
  new AppError(
    409,
    side === 'professional'
      ? 'The professional already has an appointment at that time'
      : 'The patient already has an appointment at that time',
    side === 'professional' ? 'PROFESSIONAL_CONFLICT' : 'PATIENT_CONFLICT',
  );

const invalidRange = () =>
  new AppError(400, 'The appointment must end after it starts and last at most 12 hours', 'INVALID_TIME_RANGE');

// 422: the request is well-formed but names something that can't be booked.
// An unknown and another organization's patient look the same.
const invalidPatient = () => new AppError(422, 'Unknown patient', 'INVALID_PATIENT');
const archivedPatient = () => new AppError(422, 'The patient is archived', 'PATIENT_ARCHIVED');
const invalidProfessional = () =>
  new AppError(422, 'The professional must be an active owner or psychologist of this practice', 'INVALID_PROFESSIONAL');

function toResponse(appointment: Appointment) {
  return {
    id: appointment.id,
    patient: appointment.patient,
    professional: appointment.professional,
    startsAt: appointment.startsAt.toISOString(),
    endsAt: appointment.endsAt.toISOString(),
    status: appointment.status,
    modality: appointment.modality,
    createdAt: appointment.createdAt.toISOString(),
    updatedAt: appointment.updatedAt.toISOString(),
    cancelledAt: appointment.cancelledAt ? appointment.cancelledAt.toISOString() : null,
  };
}

appointmentsRouter.get(
  '/appointments',
  ...guard('appointments.read'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const query = listAppointmentsQuerySchema.safeParse(req.query);
    if (!query.success) throw new AppError(400, 'Invalid query parameters', 'BAD_REQUEST');

    const appointments = await withTenantContext({ userId, organizationId }, (tx) =>
      buildAppointmentsModule(tx).listAppointments({
        organizationId,
        from: new Date(query.data.from),
        to: new Date(query.data.to),
        professionalId: query.data.professionalId,
        patientId: query.data.patientId,
        includeCancelled: query.data.includeCancelled,
      }),
    );
    res.json(listAppointmentsResponseSchema.parse({ appointments: appointments.map(toResponse) }));
  }),
);

appointmentsRouter.post(
  '/appointments',
  ...guard('appointments.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const body = createAppointmentRequestSchema.safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');

    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildAppointmentsModule(tx).scheduleAppointment({
        organizationId,
        createdBy: userId,
        patientId: body.data.patientId,
        professionalId: body.data.professionalId,
        startsAt: new Date(body.data.startsAt),
        endsAt: new Date(body.data.endsAt),
        modality: body.data.modality ?? 'in_person',
        status: body.data.status ?? 'scheduled',
      }),
    );

    switch (result.kind) {
      case 'created':
        res.status(201).json(appointmentResponseSchema.parse({ appointment: toResponse(result.appointment) }));
        return;
      case 'invalid_range':
        throw invalidRange();
      case 'invalid_patient':
        throw invalidPatient();
      case 'patient_archived':
        throw archivedPatient();
      case 'invalid_professional':
        throw invalidProfessional();
      case 'conflict':
        throw conflict(result.side);
    }
  }),
);

appointmentsRouter.get(
  '/appointments/:appointmentId',
  ...guard('appointments.read'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const appointmentId = appointmentIdParam(req);
    const appointment = await withTenantContext({ userId, organizationId }, (tx) =>
      buildAppointmentsModule(tx).getAppointment({ organizationId, appointmentId }),
    );
    if (!appointment) throw notFound();
    res.json(appointmentResponseSchema.parse({ appointment: toResponse(appointment) }));
  }),
);

appointmentsRouter.patch(
  '/appointments/:appointmentId',
  ...guard('appointments.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const appointmentId = appointmentIdParam(req);
    const body = updateAppointmentRequestSchema.safeParse(req.body ?? {});
    if (!body.success) throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');

    const changes: AppointmentChanges = {};
    if (body.data.professionalId !== undefined) changes.professionalId = body.data.professionalId;
    if (body.data.startsAt !== undefined) changes.startsAt = new Date(body.data.startsAt);
    if (body.data.endsAt !== undefined) changes.endsAt = new Date(body.data.endsAt);
    if (body.data.modality !== undefined) changes.modality = body.data.modality;
    if (body.data.status !== undefined) changes.status = body.data.status;

    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildAppointmentsModule(tx).changeAppointment({ organizationId, appointmentId, changes, now: new Date() }),
    );

    switch (result.kind) {
      case 'updated':
        res.json(appointmentResponseSchema.parse({ appointment: toResponse(result.appointment) }));
        return;
      case 'not_found':
        throw notFound();
      case 'cancelled':
        throw new AppError(409, 'Cancelled appointments cannot be changed', 'APPOINTMENT_CANCELLED');
      case 'invalid_range':
        throw invalidRange();
      case 'invalid_professional':
        throw invalidProfessional();
      case 'not_yet_happened':
        throw new AppError(422, 'An appointment can be marked completed or no-show only once it has started', 'NOT_YET_HAPPENED');
      case 'conflict':
        throw conflict(result.side);
    }
  }),
);

// Cancel is an action, not a DELETE: the row stays (ADR-0015).
appointmentsRouter.post(
  '/appointments/:appointmentId/cancel',
  ...guard('appointments.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const appointmentId = appointmentIdParam(req);
    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildAppointmentsModule(tx).cancelAppointment({ organizationId, appointmentId, now: new Date() }),
    );
    if (result.kind === 'not_found') throw notFound();
    if (result.kind === 'already_cancelled') {
      throw new AppError(409, 'The appointment is already cancelled', 'APPOINTMENT_CANCELLED');
    }
    res.json(appointmentResponseSchema.parse({ appointment: toResponse(result.appointment) }));
  }),
);
