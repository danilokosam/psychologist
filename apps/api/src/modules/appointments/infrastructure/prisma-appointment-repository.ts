import type { Prisma } from '@psych/db';
import type { AppointmentModality } from '@psych/types';
import type { Tx } from '../../../shared/db/tenant-context';
import { violatedExclusionConstraint } from '../../../shared/db/errors';
import type { Appointment, AppointmentChanges } from '../domain/appointment';
import {
  AppointmentConflictError,
  type AppointmentRepository,
  type AppointmentWindow,
} from '../application/ports/appointment-repository';

const APPOINTMENT_SELECT = {
  id: true,
  organizationId: true,
  scheduledStart: true,
  scheduledEnd: true,
  status: true,
  modality: true,
  createdAt: true,
  updatedAt: true,
  cancelledAt: true,
  professionalId: true,
  patient: { select: { id: true, fullName: true } },
} as const;

type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof APPOINTMENT_SELECT }>;

/**
 * Prisma-backed AppointmentRepository on the request's RLS transaction. The
 * appointments policies, exclusion constraints, CHECKs, composite FKs and
 * column grants are the independent second check on all of it.
 */
export class PrismaAppointmentRepository implements AppointmentRepository {
  constructor(private readonly tx: Tx) {}

  async findById(organizationId: string, appointmentId: string): Promise<Appointment | null> {
    const row = await this.tx.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: APPOINTMENT_SELECT,
    });
    if (!row) return null;
    const [appointment] = await this.withProfessionalNames([row]);
    return appointment ?? null;
  }

  async listInWindow(window: AppointmentWindow): Promise<Appointment[]> {
    const rows = await this.tx.appointment.findMany({
      where: {
        organizationId: window.organizationId,
        // Overlap with [from, to): starts before the window ends and ends
        // after it starts -- so an appointment crossing midnight shows on both days.
        scheduledStart: { lt: window.to },
        scheduledEnd: { gt: window.from },
        ...(window.professionalId ? { professionalId: window.professionalId } : {}),
        ...(window.patientId ? { patientId: window.patientId } : {}),
        ...(window.includeCancelled ? {} : { status: { not: 'cancelled' } }),
      },
      select: APPOINTMENT_SELECT,
      orderBy: [{ scheduledStart: 'asc' }, { id: 'asc' }],
    });
    return this.withProfessionalNames(rows);
  }

  /**
   * Professional names, looked up separately rather than through a required
   * relation: profiles_select only shows profiles of ACTIVE co-members, so a
   * professional suspended after booking has an invisible profile -- that
   * must show as "no name", not crash the whole calendar.
   */
  private async withProfessionalNames(rows: AppointmentRow[]): Promise<Appointment[]> {
    const ids = [...new Set(rows.map((row) => row.professionalId))];
    const profiles = ids.length
      ? await this.tx.profile.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } })
      : [];
    const names = new Map(profiles.map((profile) => [profile.id, profile.fullName]));
    return rows.map((row) => toAppointment(row, names.get(row.professionalId) ?? null));
  }

  async insert(record: {
    organizationId: string;
    createdBy: string;
    patientId: string;
    professionalId: string;
    startsAt: Date;
    endsAt: Date;
    modality: AppointmentModality;
    status: 'scheduled' | 'confirmed';
  }): Promise<string> {
    return withConflictDetection(async () => {
      const row = await this.tx.appointment.create({
        // Explicit allow-list -- never a spread of request data.
        data: {
          organizationId: record.organizationId,
          createdBy: record.createdBy,
          patientId: record.patientId,
          professionalId: record.professionalId,
          scheduledStart: record.startsAt,
          scheduledEnd: record.endsAt,
          modality: record.modality,
          status: record.status,
        },
        select: { id: true },
      });
      return row.id;
    });
  }

  async updateIfActive(organizationId: string, appointmentId: string, changes: AppointmentChanges): Promise<boolean> {
    return withConflictDetection(async () => {
      const { count } = await this.tx.appointment.updateMany({
        where: { id: appointmentId, organizationId, status: { not: 'cancelled' } },
        data: {
          ...(changes.professionalId !== undefined && { professionalId: changes.professionalId }),
          ...(changes.startsAt !== undefined && { scheduledStart: changes.startsAt }),
          ...(changes.endsAt !== undefined && { scheduledEnd: changes.endsAt }),
          ...(changes.modality !== undefined && { modality: changes.modality }),
          ...(changes.status !== undefined && { status: changes.status }),
        },
      });
      return count === 1;
    });
  }

  async cancel(organizationId: string, appointmentId: string, now: Date): Promise<boolean> {
    const { count } = await this.tx.appointment.updateMany({
      where: { id: appointmentId, organizationId, status: { not: 'cancelled' } },
      data: { status: 'cancelled', cancelledAt: now },
    });
    return count === 1;
  }

  async patientStatus(organizationId: string, patientId: string) {
    const row = await this.tx.patient.findFirst({
      where: { id: patientId, organizationId },
      select: { status: true },
    });
    return row?.status ?? null;
  }

  async isActiveClinician(organizationId: string, userId: string): Promise<boolean> {
    const count = await this.tx.membership.count({
      where: { organizationId, userId, status: 'active', role: { in: ['owner', 'psychologist'] } },
    });
    return count === 1;
  }
}

// A failed statement aborts the surrounding transaction, so translating the
// error is all that can be done here -- the request ends with a 409.
async function withConflictDetection<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (violatedExclusionConstraint(error, 'no_professional_overlap')) {
      throw new AppointmentConflictError('professional');
    }
    if (violatedExclusionConstraint(error, 'no_patient_overlap')) {
      throw new AppointmentConflictError('patient');
    }
    throw error;
  }
}

function toAppointment(row: AppointmentRow, professionalName: string | null): Appointment {
  return {
    id: row.id,
    organizationId: row.organizationId,
    patient: { id: row.patient.id, fullName: row.patient.fullName },
    professional: { userId: row.professionalId, fullName: professionalName },
    startsAt: row.scheduledStart,
    endsAt: row.scheduledEnd,
    status: row.status,
    modality: row.modality,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cancelledAt: row.cancelledAt,
  };
}
