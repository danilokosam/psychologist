import { describe, expect, it } from 'vitest';
import type { AuditEntry, AuditTrail } from '../../../../shared/audit/audit-trail';
import type { ClinicalNote, ClinicalSession } from '../../domain/clinical';
import { isInFuture } from '../../domain/clinical';
import type { ClinicalNoteRepository, ClinicalSessionRepository } from '../ports/clinical-repositories';
import { readSessionNotes, reviseNote } from './notes';
import { recordSession } from './sessions';

const ORG = 'org';
const AUTHOR = 'author';
const NOW = new Date('2026-11-15T12:00:00Z');

const session: ClinicalSession = {
  id: 's-1',
  organizationId: ORG,
  patient: { id: 'p-1', fullName: 'Synthetic' },
  professional: { userId: AUTHOR, fullName: null },
  appointmentId: null,
  startedAt: NOW,
  durationMinutes: 50,
  createdAt: NOW,
  updatedAt: NOW,
};

const note = (version = 1): ClinicalNote => ({
  id: 'n-1',
  organizationId: ORG,
  sessionId: 's-1',
  author: { userId: AUTHOR, fullName: null },
  version,
  content: 'synthetic',
  createdAt: NOW,
  updatedAt: NOW,
});

function fakes(overrides: { patientStatus?: 'active' | 'archived'; version?: number } = {}) {
  const audit: AuditEntry[] = [];
  const appended: number[] = [];
  let version = overrides.version ?? 1;
  const sessions = {
    findById: async () => session,
    patientStatus: async () => overrides.patientStatus ?? 'active',
  } as unknown as ClinicalSessionRepository;
  const notes: ClinicalNoteRepository = {
    listForSession: async () => [note(version)],
    findById: async () => note(version),
    open: async () => 'n-1',
    appendVersion: async (r) => {
      appended.push(r.version);
      version = r.version;
    },
    history: async () => [],
  };
  const trail: AuditTrail = { record: async (entries) => void audit.push(...entries) };
  return { deps: { sessions, notes, audit: trail }, audit, appended };
}

describe('reviseNote', () => {
  const revise = (deps: ReturnType<typeof fakes>['deps'], actorUserId: string, baseVersion: number) =>
    reviseNote({ organizationId: ORG, noteId: 'n-1', actorUserId, content: 'new text', baseVersion }, deps);

  it('refuses anyone but the author, writing and auditing nothing', async () => {
    const f = fakes();
    expect(await revise(f.deps, 'another-psychologist', 1)).toEqual({ kind: 'not_author' });
    expect(f.appended).toEqual([]);
    expect(f.audit).toEqual([]);
  });

  it('appends baseVersion + 1 and audits it without content', async () => {
    const f = fakes();
    expect((await revise(f.deps, AUTHOR, 1)).kind).toBe('revised');
    expect(f.appended).toEqual([2]);
    expect(f.audit).toEqual([
      expect.objectContaining({ action: 'clinical_note.revise', resourceId: 'n-1', metadata: { version: 2 } }),
    ]);
    expect(JSON.stringify(f.audit)).not.toContain('new text');
  });

  it('a stale base is a conflict', async () => {
    const f = fakes({ version: 3 });
    expect(await revise(f.deps, AUTHOR, 2)).toEqual({ kind: 'stale', currentVersion: 3 });
    expect(f.appended).toEqual([]);
  });

  it('an archived patient’s notes are frozen', async () => {
    const f = fakes({ patientStatus: 'archived' });
    expect(await revise(f.deps, AUTHOR, 1)).toEqual({ kind: 'patient_archived' });
  });
});

describe('readSessionNotes', () => {
  it('audits one read per note returned, as the reader', async () => {
    const f = fakes();
    const notes = await readSessionNotes({ organizationId: ORG, sessionId: 's-1', actorUserId: 'reader' }, f.deps);
    expect(notes).toHaveLength(1);
    expect(f.audit).toEqual([
      expect.objectContaining({ action: 'clinical_note.read', actorUserId: 'reader', organizationId: ORG }),
    ]);
  });
});

describe('recordSession', () => {
  it('refuses a session dated in the future, beyond a small clock-skew tolerance', async () => {
    expect(isInFuture(new Date(NOW.getTime() + 4 * 60_000), NOW)).toBe(false);
    expect(isInFuture(new Date(NOW.getTime() + 6 * 60_000), NOW)).toBe(true);
    const sessions = {
      patientStatus: async () => 'active',
      isActiveClinician: async () => true,
    } as unknown as ClinicalSessionRepository;
    const result = await recordSession(
      {
        organizationId: ORG,
        createdBy: AUTHOR,
        patientId: 'p-1',
        professionalId: AUTHOR,
        appointmentId: null,
        startedAt: new Date('2027-01-01T00:00:00Z'),
        durationMinutes: 50,
        now: NOW,
      },
      { sessions },
    );
    expect(result).toEqual({ kind: 'in_future' });
  });
});
