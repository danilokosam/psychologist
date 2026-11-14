import type { Tx } from '../../../shared/db/tenant-context';
import type { ClinicalNote, NoteVersion } from '../domain/clinical';
import type { ClinicalNoteRepository } from '../application/ports/clinical-repositories';
import { namesOf } from './names';

// The current version is the highest one (ADR-0016) -- no pointer column to
// keep in sync, so clinical_notes never needs an UPDATE.
const NOTE_SELECT = {
  id: true,
  organizationId: true,
  clinicalSessionId: true,
  authorId: true,
  createdAt: true,
  versions: {
    orderBy: { version: 'desc' },
    take: 1,
    select: { version: true, content: true, createdAt: true },
  },
} as const;

type NoteRow = {
  id: string;
  organizationId: string;
  clinicalSessionId: string;
  authorId: string;
  createdAt: Date;
  versions: { version: number; content: string; createdAt: Date }[];
};

/**
 * Notes under RLS: for admin_staff every query here returns nothing, and a
 * version insert by anyone but the note's author is refused -- regardless of
 * what the use case checked first.
 */
export class PrismaClinicalNoteRepository implements ClinicalNoteRepository {
  constructor(private readonly tx: Tx) {}

  async listForSession(organizationId: string, sessionId: string): Promise<ClinicalNote[]> {
    const rows = await this.tx.clinicalNote.findMany({
      where: { organizationId, clinicalSessionId: sessionId },
      select: NOTE_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return this.toNotes(rows);
  }

  async findById(organizationId: string, noteId: string): Promise<ClinicalNote | null> {
    const row = await this.tx.clinicalNote.findFirst({ where: { id: noteId, organizationId }, select: NOTE_SELECT });
    return row ? ((await this.toNotes([row]))[0] ?? null) : null;
  }

  async open(record: { organizationId: string; sessionId: string; authorId: string; content: string }) {
    const note = await this.tx.clinicalNote.create({
      data: { organizationId: record.organizationId, clinicalSessionId: record.sessionId, authorId: record.authorId },
      select: { id: true },
    });
    await this.tx.clinicalNoteVersion.create({
      data: {
        organizationId: record.organizationId,
        clinicalNoteId: note.id,
        version: 1,
        content: record.content,
        createdBy: record.authorId,
      },
      select: { id: true },
    });
    return note.id;
  }

  async appendVersion(record: { organizationId: string; noteId: string; authorId: string; version: number; content: string }) {
    await this.tx.clinicalNoteVersion.create({
      data: {
        organizationId: record.organizationId,
        clinicalNoteId: record.noteId,
        version: record.version,
        content: record.content,
        createdBy: record.authorId,
      },
      select: { id: true },
    });
  }

  async history(organizationId: string, noteId: string): Promise<NoteVersion[]> {
    const rows = await this.tx.clinicalNoteVersion.findMany({
      where: { organizationId, clinicalNoteId: noteId },
      select: { version: true, content: true, createdAt: true, createdBy: true },
      orderBy: { version: 'asc' },
    });
    const names = await namesOf(this.tx, rows.map((r) => r.createdBy));
    return rows.map((r) => ({
      version: r.version,
      content: r.content,
      createdAt: r.createdAt,
      createdBy: { userId: r.createdBy, fullName: names.get(r.createdBy) ?? null },
    }));
  }

  private async toNotes(rows: NoteRow[]): Promise<ClinicalNote[]> {
    const names = await namesOf(this.tx, rows.map((r) => r.authorId));
    return rows.flatMap((row) => {
      const current = row.versions[0];
      // Unreachable while open() writes version 1 in the same transaction.
      if (!current) return [];
      return [
        {
          id: row.id,
          organizationId: row.organizationId,
          sessionId: row.clinicalSessionId,
          author: { userId: row.authorId, fullName: names.get(row.authorId) ?? null },
          version: current.version,
          content: current.content,
          createdAt: row.createdAt,
          updatedAt: current.createdAt,
        },
      ];
    });
  }
}
