import { describe, expect, it } from 'vitest';
import type { Patient } from '../../domain/patient';
import type { PatientRepository } from '../ports/patient-repository';
import { archivePatient, restorePatient } from './archive-patient';
import { listPatients } from './read-patients';
import { updatePatient } from './update-patient';

const ORG = '22222222-2222-4222-8222-222222222222';
const NOW = new Date('2026-11-15T12:00:00Z');

function patient(overrides: Partial<Patient> = {}): Patient {
  return {
    id: 'p-1',
    organizationId: ORG,
    fullName: 'Synthetic Patient',
    dateOfBirth: null,
    email: null,
    phone: null,
    emergencyContactName: null,
    emergencyContactPhone: null,
    status: 'active',
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

/** In-memory stand-in that mimics the adapter's conditional writes. */
function fakeRepo(seed: Patient[]) {
  const rows = seed.map((p) => ({ ...p }));
  const calls: string[] = [];
  const repo: PatientRepository = {
    insert: async () => {
      throw new Error('not used');
    },
    findById: async (organizationId, id) =>
      rows.find((p) => p.id === id && p.organizationId === organizationId) ?? null,
    list: async (filter) => {
      calls.push(`list:${filter.offset}:${filter.limit}:${filter.search ?? ''}`);
      return { patients: rows, total: rows.length };
    },
    updateIfEditable: async (organizationId, id, changes) => {
      const row = rows.find((p) => p.id === id && p.organizationId === organizationId);
      if (!row || row.status === 'archived') return false;
      Object.assign(row, changes);
      return true;
    },
    archive: async (organizationId, id, now) => {
      const row = rows.find((p) => p.id === id && p.organizationId === organizationId);
      if (!row || row.status === 'archived') return false;
      Object.assign(row, { status: 'archived', archivedAt: now });
      return true;
    },
    restore: async (organizationId, id) => {
      const row = rows.find((p) => p.id === id && p.organizationId === organizationId);
      if (!row || row.status !== 'archived') return false;
      Object.assign(row, { status: 'active', archivedAt: null });
      return true;
    },
  };
  return { repo, rows, calls };
}

describe('updatePatient', () => {
  it('applies the changes and returns the fresh row', async () => {
    const { repo } = fakeRepo([patient()]);
    const result = await updatePatient(
      { organizationId: ORG, patientId: 'p-1', changes: { fullName: 'Renamed' } },
      { patients: repo },
    );
    expect(result).toMatchObject({ kind: 'updated', patient: { fullName: 'Renamed' } });
  });

  it('refuses archived patients without writing', async () => {
    const { repo, rows } = fakeRepo([patient({ status: 'archived', archivedAt: NOW })]);
    const result = await updatePatient(
      { organizationId: ORG, patientId: 'p-1', changes: { fullName: 'Renamed' } },
      { patients: repo },
    );
    expect(result).toEqual({ kind: 'archived' });
    expect(rows[0]!.fullName).toBe('Synthetic Patient');
  });

  it('reports a patient archived between the read and the write as archived', async () => {
    const { repo } = fakeRepo([patient()]);
    const racing: PatientRepository = { ...repo, updateIfEditable: async () => false };
    const result = await updatePatient(
      { organizationId: ORG, patientId: 'p-1', changes: { fullName: 'Renamed' } },
      { patients: racing },
    );
    expect(result).toEqual({ kind: 'archived' });
  });

  it('is not_found for another organization’s id', async () => {
    const { repo } = fakeRepo([patient({ organizationId: 'other-org' })]);
    const result = await updatePatient(
      { organizationId: ORG, patientId: 'p-1', changes: { fullName: 'X' } },
      { patients: repo },
    );
    expect(result).toEqual({ kind: 'not_found' });
  });
});

describe('archivePatient / restorePatient', () => {
  it('archives, then refuses to archive again', async () => {
    const { repo } = fakeRepo([patient()]);
    const first = await archivePatient({ organizationId: ORG, patientId: 'p-1', now: NOW }, { patients: repo });
    expect(first).toMatchObject({ kind: 'done', patient: { status: 'archived', archivedAt: NOW } });
    const second = await archivePatient({ organizationId: ORG, patientId: 'p-1', now: NOW }, { patients: repo });
    expect(second).toEqual({ kind: 'conflict' });
  });

  it('restores only archived patients', async () => {
    const { repo } = fakeRepo([patient()]);
    expect(await restorePatient({ organizationId: ORG, patientId: 'p-1' }, { patients: repo })).toEqual({
      kind: 'conflict',
    });
    await archivePatient({ organizationId: ORG, patientId: 'p-1', now: NOW }, { patients: repo });
    expect(await restorePatient({ organizationId: ORG, patientId: 'p-1' }, { patients: repo })).toMatchObject({
      kind: 'done',
      patient: { status: 'active', archivedAt: null },
    });
  });

  it('is not_found for an unknown id', async () => {
    const { repo } = fakeRepo([]);
    expect(
      await archivePatient({ organizationId: ORG, patientId: 'nope', now: NOW }, { patients: repo }),
    ).toEqual({ kind: 'not_found' });
  });
});

describe('listPatients', () => {
  it('turns page/pageSize into offset/limit and drops a blank search', async () => {
    const { repo, calls } = fakeRepo([]);
    await listPatients({ organizationId: ORG, search: '   ', page: 3, pageSize: 20 }, { patients: repo });
    await listPatients({ organizationId: ORG, search: ' ana ', page: 1, pageSize: 10 }, { patients: repo });
    expect(calls).toEqual(['list:40:20:', 'list:0:10:ana']);
  });
});
