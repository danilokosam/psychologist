import type { Prisma, PatientStatus } from '@psych/db';
import type { Tx } from '../../../shared/db/tenant-context';
import type { Patient, PatientDetails } from '../domain/patient';
import type { PatientListFilter, PatientRepository } from '../application/ports/patient-repository';

const PATIENT_SELECT = {
  id: true,
  organizationId: true,
  fullName: true,
  dateOfBirth: true,
  email: true,
  phone: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
} as const;

type PatientRow = Prisma.PatientGetPayload<{ select: typeof PATIENT_SELECT }>;

const WORKING_LIST: PatientStatus[] = ['active', 'inactive'];

/**
 * Prisma-backed PatientRepository, on the request's RLS transaction. The
 * patients policies, CHECK constraints and column grants (see the migration)
 * are the independent second check on everything here.
 *
 * State changes use `updateMany` with the expected current status in the
 * WHERE clause: a concurrent archive can't be silently overwritten by an
 * edit (the edit matches zero rows), and there is no `RETURNING` to trip
 * over the SELECT policy.
 */
export class PrismaPatientRepository implements PatientRepository {
  constructor(private readonly tx: Tx) {}

  async insert(record: PatientDetails & { organizationId: string; createdBy: string }): Promise<Patient> {
    const row = await this.tx.patient.create({
      // Explicit allow-list -- never a spread of request data.
      data: {
        organizationId: record.organizationId,
        createdBy: record.createdBy,
        fullName: record.fullName,
        dateOfBirth: toDbDate(record.dateOfBirth),
        email: record.email,
        phone: record.phone,
        emergencyContactName: record.emergencyContactName,
        emergencyContactPhone: record.emergencyContactPhone,
        status: record.status,
      },
      select: PATIENT_SELECT,
    });
    return toPatient(row);
  }

  async findById(organizationId: string, patientId: string): Promise<Patient | null> {
    const row = await this.tx.patient.findFirst({
      where: { id: patientId, organizationId },
      select: PATIENT_SELECT,
    });
    return row ? toPatient(row) : null;
  }

  async list(filter: PatientListFilter): Promise<{ patients: Patient[]; total: number }> {
    const search = filter.search ? escapeLike(filter.search) : undefined;
    const where: Prisma.PatientWhereInput = {
      organizationId: filter.organizationId,
      status: filter.status ?? { in: WORKING_LIST },
      ...(search
        ? {
            OR: [
              { fullName: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.tx.patient.findMany({
        where,
        select: PATIENT_SELECT,
        // id as tie-breaker: two patients with the same name must not swap
        // places between pages.
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        skip: filter.offset,
        take: filter.limit,
      }),
      this.tx.patient.count({ where }),
    ]);
    return { patients: rows.map(toPatient), total };
  }

  async updateIfEditable(
    organizationId: string,
    patientId: string,
    changes: Partial<PatientDetails>,
  ): Promise<boolean> {
    const { count } = await this.tx.patient.updateMany({
      where: { id: patientId, organizationId, status: { in: WORKING_LIST } },
      // Explicit allow-list, key by key: only fields the caller actually sent.
      data: {
        ...(changes.fullName !== undefined && { fullName: changes.fullName }),
        ...(changes.dateOfBirth !== undefined && { dateOfBirth: toDbDate(changes.dateOfBirth) }),
        ...(changes.email !== undefined && { email: changes.email }),
        ...(changes.phone !== undefined && { phone: changes.phone }),
        ...(changes.emergencyContactName !== undefined && {
          emergencyContactName: changes.emergencyContactName,
        }),
        ...(changes.emergencyContactPhone !== undefined && {
          emergencyContactPhone: changes.emergencyContactPhone,
        }),
        ...(changes.status !== undefined && { status: changes.status }),
      },
    });
    return count === 1;
  }

  async archive(organizationId: string, patientId: string, now: Date): Promise<boolean> {
    const { count } = await this.tx.patient.updateMany({
      where: { id: patientId, organizationId, status: { in: WORKING_LIST } },
      data: { status: 'archived', archivedAt: now },
    });
    return count === 1;
  }

  async restore(organizationId: string, patientId: string): Promise<boolean> {
    const { count } = await this.tx.patient.updateMany({
      where: { id: patientId, organizationId, status: 'archived' },
      data: { status: 'active', archivedAt: null },
    });
    return count === 1;
  }
}

// Prisma's `contains` becomes `LIKE '%' || value || '%'` WITHOUT escaping the
// value, so a search for "%" or "_" would match every patient (found by the
// integration suite). Backslash is Postgres' default LIKE escape character.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

// `@db.Date` columns travel as Date at UTC midnight; convert at the edge so
// the rest of the code only ever sees 'YYYY-MM-DD'.
function toDbDate(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

function toPatient(row: PatientRow): Patient {
  return {
    id: row.id,
    organizationId: row.organizationId,
    fullName: row.fullName,
    dateOfBirth: row.dateOfBirth ? row.dateOfBirth.toISOString().slice(0, 10) : null,
    email: row.email,
    phone: row.phone,
    emergencyContactName: row.emergencyContactName,
    emergencyContactPhone: row.emergencyContactPhone,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}
