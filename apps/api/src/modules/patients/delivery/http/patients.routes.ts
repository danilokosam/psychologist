import { Router, type Request } from 'express';
import { z } from 'zod';
import {
  createPatientRequestSchema,
  listPatientsQuerySchema,
  listPatientsResponseSchema,
  patientResponseSchema,
  updatePatientRequestSchema,
} from '@psych/types';
import { buildPatientsModule } from '../../../../composition/container';
import { withTenantContext } from '../../../../shared/db/tenant-context';
import { PERMISSIONS, type Permission } from '../../../../shared/authorization/permissions';
import { requireAuth } from '../../../../shared/middleware/require-auth';
import { resolveOrganization } from '../../../../shared/middleware/resolve-organization';
import { requireRole } from '../../../../shared/middleware/require-role';
import { AppError } from '../../../../shared/middleware/error-handler';
import { asyncHandler } from '../../../../shared/http/async-handler';
import { tenantContext } from '../../../../shared/http/request-context';
import type { Patient, PatientDetails } from '../../domain/patient';
import type { ArchiveResult } from '../../application/use-cases/archive-patient';

export const patientsRouter = Router();

const guard = (permission: Permission) =>
  [requireAuth, resolveOrganization, requireRole(PERMISSIONS[permission])] as const;

const notFound = () => new AppError(404, 'Patient not found', 'NOT_FOUND');

/**
 * A malformed id is answered exactly like an unknown one, and an unknown one
 * exactly like another organization's: 404 either way, so ids from other
 * tenants cannot be probed (docs/SECURITY.md).
 */
function patientIdParam(req: Request): string {
  const id = z.uuid().safeParse(req.params.patientId);
  if (!id.success) throw notFound();
  return id.data;
}

function toResponse(patient: Patient) {
  return {
    id: patient.id,
    fullName: patient.fullName,
    dateOfBirth: patient.dateOfBirth,
    email: patient.email,
    phone: patient.phone,
    emergencyContactName: patient.emergencyContactName,
    emergencyContactPhone: patient.emergencyContactPhone,
    status: patient.status,
    createdAt: patient.createdAt.toISOString(),
    updatedAt: patient.updatedAt.toISOString(),
    archivedAt: patient.archivedAt ? patient.archivedAt.toISOString() : null,
  };
}

patientsRouter.get(
  '/patients',
  ...guard('patients.read'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const query = listPatientsQuerySchema.safeParse(req.query);
    if (!query.success) {
      throw new AppError(400, 'Invalid query parameters', 'BAD_REQUEST');
    }
    const { q, status, page, pageSize } = query.data;

    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildPatientsModule(tx).listPatients({ organizationId, search: q, status, page, pageSize }),
    );
    res.json(
      listPatientsResponseSchema.parse({
        patients: result.patients.map(toResponse),
        page,
        pageSize,
        total: result.total,
      }),
    );
  }),
);

patientsRouter.post(
  '/patients',
  ...guard('patients.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const body = createPatientRequestSchema.safeParse(req.body ?? {});
    if (!body.success) {
      throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    }

    const patient = await withTenantContext({ userId, organizationId }, (tx) =>
      buildPatientsModule(tx).createPatient({
        organizationId,
        createdBy: userId,
        details: {
          fullName: body.data.fullName,
          dateOfBirth: body.data.dateOfBirth ?? null,
          email: body.data.email ?? null,
          phone: body.data.phone ?? null,
          emergencyContactName: body.data.emergencyContactName ?? null,
          emergencyContactPhone: body.data.emergencyContactPhone ?? null,
          status: body.data.status ?? 'active',
        },
      }),
    );
    res.status(201).json(patientResponseSchema.parse({ patient: toResponse(patient) }));
  }),
);

patientsRouter.get(
  '/patients/:patientId',
  ...guard('patients.read'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const patientId = patientIdParam(req);
    const patient = await withTenantContext({ userId, organizationId }, (tx) =>
      buildPatientsModule(tx).getPatient({ organizationId, patientId }),
    );
    if (!patient) throw notFound();
    res.json(patientResponseSchema.parse({ patient: toResponse(patient) }));
  }),
);

patientsRouter.patch(
  '/patients/:patientId',
  ...guard('patients.write'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const patientId = patientIdParam(req);
    const body = updatePatientRequestSchema.safeParse(req.body ?? {});
    if (!body.success) {
      throw new AppError(400, 'Invalid request body', 'BAD_REQUEST');
    }

    // Only the keys the client actually sent; a `null` clears the field.
    const changes: Partial<PatientDetails> = {};
    for (const [key, value] of Object.entries(body.data) as [keyof PatientDetails, unknown][]) {
      if (value !== undefined) Object.assign(changes, { [key]: value });
    }

    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildPatientsModule(tx).updatePatient({ organizationId, patientId, changes }),
    );
    if (result.kind === 'not_found') throw notFound();
    if (result.kind === 'archived') {
      throw new AppError(409, 'Archived patients cannot be edited; restore first', 'PATIENT_ARCHIVED');
    }
    res.json(patientResponseSchema.parse({ patient: toResponse(result.patient) }));
  }),
);

function sendTransition(result: ArchiveResult, res: import('express').Response, conflictMessage: string) {
  if (result.kind === 'not_found') throw notFound();
  if (result.kind === 'conflict') throw new AppError(409, conflictMessage, 'CONFLICT');
  res.json(patientResponseSchema.parse({ patient: toResponse(result.patient) }));
}

// Archive and restore are actions, not a DELETE: nothing is deleted
// (ADR-0014), and a DELETE that left the row in place would be misleading.
patientsRouter.post(
  '/patients/:patientId/archive',
  ...guard('patients.archive'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const patientId = patientIdParam(req);
    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildPatientsModule(tx).archivePatient({ organizationId, patientId, now: new Date() }),
    );
    sendTransition(result, res, 'Patient is already archived');
  }),
);

patientsRouter.post(
  '/patients/:patientId/restore',
  ...guard('patients.archive'),
  asyncHandler(async (req, res) => {
    const { userId, organizationId } = tenantContext(req);
    const patientId = patientIdParam(req);
    const result = await withTenantContext({ userId, organizationId }, (tx) =>
      buildPatientsModule(tx).restorePatient({ organizationId, patientId }),
    );
    sendTransition(result, res, 'Patient is not archived');
  }),
);
