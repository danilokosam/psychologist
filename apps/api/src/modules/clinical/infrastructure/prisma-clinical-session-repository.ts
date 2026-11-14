import type { Prisma } from '@psych/db';
import type { Tx } from '../../../shared/db/tenant-context';
import type { ClinicalSession } from '../domain/clinical';
import type { ClinicalSessionRepository } from '../application/ports/clinical-repositories';
import { namesOf } from './names';

const SESSION_SELECT = {
  id: true,
  organizationId: true,
  professionalId: true,
  appointmentId: true,
  startedAt: true,
  durationMinutes: true,
  createdAt: true,
  updatedAt: true,
  patient: { select: { id: true, fullName: true } },
} as const;

type SessionRow = Prisma.ClinicalSessionGetPayload<{ select: typeof SESSION_SELECT }>;

/** On the request's RLS transaction; policies, grants and composite FKs re-check everything. */
export class PrismaClinicalSessionRepository implements ClinicalSessionRepository {
  constructor(private readonly tx: Tx) {}

  async findById(organizationId: string, sessionId: string): Promise<ClinicalSession | null> {
    const row = await this.tx.clinicalSession.findFirst({
      where: { id: sessionId, organizationId },
      select: SESSION_SELECT,
    });
    if (!row) return null;
    return (await this.withNames([row]))[0] ?? null;
  }

  async listForPatient(
    organizationId: string,
    filter: { patientId?: string | undefined; appointmentId?: string | undefined; offset: number; limit: number },
  ) {
    const where: Prisma.ClinicalSessionWhereInput = {
      organizationId,
      ...(filter.patientId ? { patientId: filter.patientId } : {}),
      ...(filter.appointmentId ? { appointmentId: filter.appointmentId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.tx.clinicalSession.findMany({
        where,
        select: SESSION_SELECT,
        orderBy: [{ startedAt: 'desc' }, { id: 'asc' }],
        skip: filter.offset,
        take: filter.limit,
      }),
      this.tx.clinicalSession.count({ where }),
    ]);
    return { sessions: await this.withNames(rows), total };
  }

  async insert(record: {
    organizationId: string;
    createdBy: string;
    patientId: string;
    professionalId: string;
    appointmentId: string | null;
    startedAt: Date;
    durationMinutes: number;
  }): Promise<string> {
    const row = await this.tx.clinicalSession.create({
      // Explicit allow-list -- never a spread of request data.
      data: {
        organizationId: record.organizationId,
        createdBy: record.createdBy,
        patientId: record.patientId,
        professionalId: record.professionalId,
        appointmentId: record.appointmentId,
        startedAt: record.startedAt,
        durationMinutes: record.durationMinutes,
      },
      select: { id: true },
    });
    return row.id;
  }

  async update(organizationId: string, sessionId: string, changes: { startedAt?: Date; durationMinutes?: number }) {
    const { count } = await this.tx.clinicalSession.updateMany({
      where: { id: sessionId, organizationId },
      data: {
        ...(changes.startedAt !== undefined && { startedAt: changes.startedAt }),
        ...(changes.durationMinutes !== undefined && { durationMinutes: changes.durationMinutes }),
      },
    });
    return count === 1;
  }

  async patientStatus(organizationId: string, patientId: string) {
    const row = await this.tx.patient.findFirst({ where: { id: patientId, organizationId }, select: { status: true } });
    return row?.status ?? null;
  }

  async isActiveClinician(organizationId: string, userId: string) {
    const count = await this.tx.membership.count({
      where: { organizationId, userId, status: 'active', role: { in: ['owner', 'psychologist'] } },
    });
    return count === 1;
  }

  async findAppointment(organizationId: string, appointmentId: string) {
    const row = await this.tx.appointment.findFirst({
      where: { id: appointmentId, organizationId },
      select: { patientId: true, professionalId: true, status: true, scheduledStart: true },
    });
    return row
      ? { patientId: row.patientId, professionalId: row.professionalId, status: row.status, startsAt: row.scheduledStart }
      : null;
  }

  async markAppointmentCompleted(organizationId: string, appointmentId: string) {
    await this.tx.appointment.updateMany({
      where: { id: appointmentId, organizationId, status: { in: ['scheduled', 'confirmed'] } },
      data: { status: 'completed' },
    });
  }

  private async withNames(rows: SessionRow[]): Promise<ClinicalSession[]> {
    const names = await namesOf(this.tx, rows.map((r) => r.professionalId));
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      patient: { id: row.patient.id, fullName: row.patient.fullName },
      professional: { userId: row.professionalId, fullName: names.get(row.professionalId) ?? null },
      appointmentId: row.appointmentId,
      startedAt: row.startedAt,
      durationMinutes: row.durationMinutes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }
}
