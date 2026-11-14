'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import {
  NOTE_MAX_CHARS,
  clinicalNoteResponseSchema,
  listClinicalNotesResponseSchema,
  noteHistoryResponseSchema,
  type ClinicalNote,
  type NoteVersion,
} from '@psych/types';
import { ApiError, apiFetch } from '@/lib/api-client';
import { ui } from '@/lib/ui';
import { Alert, Badge, Spinner } from '../ui/feedback';

/**
 * Clinical notes of one session (F-009). Rendered only for clinicians -- the
 * API refuses everyone else (403) and RLS hides the rows from them anyway.
 *
 * Every load of this component is an audited read on the server (F-012), so
 * nothing here fetches notes speculatively (no prefetch, no polling), and the
 * history is fetched only when explicitly opened.
 */
export function SessionNotes({
  organizationId,
  sessionId,
  userId,
  frozen,
}: {
  organizationId: string;
  sessionId: string;
  userId: string;
  frozen: boolean;
}) {
  const t = useTranslations('clinical');
  const [notes, setNotes] = useState<ClinicalNote[] | null>(null);
  const [failed, setFailed] = useState(false);

  const fetchNotes = useCallback(
    async () => listClinicalNotesResponseSchema.parse(await apiFetch<unknown>(`/clinical-sessions/${sessionId}/notes`, { organizationId })).notes,
    [organizationId, sessionId],
  );

  useEffect(() => {
    let cancelled = false;
    fetchNotes().then(
      (list) => {
        if (!cancelled) setNotes(list);
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fetchNotes]);

  if (failed) return <Alert tone="danger">{t('notesLoadFailed')}</Alert>;
  if (notes === null) return <Spinner label={t('loading')} />;

  const mine = notes.find((n) => n.author.userId === userId) ?? null;
  const others = notes.filter((n) => n.author.userId !== userId);

  return (
    <section className="space-y-4" aria-labelledby="notes-title">
      <div className="flex items-center gap-2">
        <h2 id="notes-title" className={ui.h2}>{t('notes')}</h2>
        <Badge tone="primary">{t('confidential')}</Badge>
      </div>
      {frozen ? (
        <Alert tone="info">{t('frozen')}</Alert>
      ) : (
        <MyNote
          key={mine ? `${mine.id}:${mine.version}` : 'new'}
          organizationId={organizationId}
          sessionId={sessionId}
          note={mine}
          onSaved={(saved) => setNotes((list) => [...(list ?? []).filter((n) => n.id !== saved.id), saved])}
        />
      )}
      {frozen && mine ? <ReadOnlyNote organizationId={organizationId} note={mine} /> : null}
      {others.map((note) => (
        <ReadOnlyNote key={note.id} organizationId={organizationId} note={note} />
      ))}
      {notes.length === 0 && frozen ? <p className={ui.muted}>{t('noNotes')}</p> : null}
    </section>
  );
}

/** The caller's own note: create it, or save a new version (never an overwrite). */
function MyNote({
  organizationId,
  sessionId,
  note,
  onSaved,
}: {
  organizationId: string;
  sessionId: string;
  note: ClinicalNote | null;
  onSaved: (note: ClinicalNote) => void;
}) {
  const t = useTranslations('clinical');
  const format = useFormatter();
  const [content, setContent] = useState(note?.content ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = content !== (note?.content ?? '');

  // Losing clinical text to a stray click is the one failure worth a prompt.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim()) return;
    setPending(true);
    setError(null);
    try {
      const raw = note
        ? await apiFetch<unknown>(`/clinical-notes/${note.id}/versions`, {
            method: 'POST',
            organizationId,
            body: { content, baseVersion: note.version },
          })
        : await apiFetch<unknown>(`/clinical-sessions/${sessionId}/notes`, { method: 'POST', organizationId, body: { content } });
      onSaved(clinicalNoteResponseSchema.parse(raw).note);
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : '';
      setError(code === 'NOTE_STALE' || code === 'NOTE_EXISTS' ? 'errors.NOTE_STALE' : code === 'PATIENT_ARCHIVED' ? 'frozen' : 'errors.generic');
      setPending(false);
    }
  }

  return (
    <form onSubmit={save} className={`${ui.card} space-y-3 border-primary/40`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor="my-note" className={ui.label}>{note ? t('myNote') : t('newNote')}</label>
        {note ? (
          <span className="text-xs text-muted">
            {t('versionInfo', { version: note.version, date: format.dateTime(new Date(note.updatedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
          </span>
        ) : null}
      </div>
      <textarea
        id="my-note"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={10}
        maxLength={NOTE_MAX_CHARS}
        // Browser "enhanced" spell-check can send the text to a third-party
        // service; clinical text must never leave the app that way.
        spellCheck={false}
        autoComplete="off"
        className={`${ui.input} min-h-48 font-sans leading-relaxed`}
      />
      {error ? <Alert tone="danger">{t(error)}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || !dirty || !content.trim()} className={ui.button.primary}>
          {pending ? t('saving') : note ? t('saveVersion') : t('saveNote')}
        </button>
        <span className="text-xs text-muted">{note ? t('versionsKept') : t('onlyYouEdit')}</span>
      </div>
      {note ? <History organizationId={organizationId} noteId={note.id} /> : null}
    </form>
  );
}

function ReadOnlyNote({ organizationId, note }: { organizationId: string; note: ClinicalNote }) {
  const t = useTranslations('clinical');
  const format = useFormatter();
  return (
    <article className={`${ui.card} space-y-3`}>
      <header className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium">{note.author.fullName ?? t('formerMember')}</span>
        <span className="text-xs text-muted">
          {t('versionInfo', { version: note.version, date: format.dateTime(new Date(note.updatedAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
        </span>
      </header>
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{note.content}</p>
      <History organizationId={organizationId} noteId={note.id} />
    </article>
  );
}

/** Fetched only when opened: each fetch is an audited read of every version. */
function History({ organizationId, noteId }: { organizationId: string; noteId: string }) {
  const t = useTranslations('clinical');
  const format = useFormatter();
  const [versions, setVersions] = useState<NoteVersion[] | null>(null);
  const [open, setOpen] = useState(false);

  async function toggle() {
    if (open) return setOpen(false);
    setOpen(true);
    const raw = await apiFetch<unknown>(`/clinical-notes/${noteId}/versions`, { organizationId });
    setVersions(noteHistoryResponseSchema.parse(raw).versions);
  }

  return (
    <div className="text-sm">
      <button type="button" onClick={() => void toggle()} aria-expanded={open} className={`${ui.link} text-xs`}>
        {open ? t('hideHistory') : t('showHistory')}
      </button>
      {open ? (
        versions === null ? (
          <Spinner label={t('loading')} />
        ) : (
          <ol className="mt-2 space-y-2 border-l-2 border-border pl-3">
            {[...versions].reverse().map((v) => (
              <li key={v.version} className="space-y-1">
                <p className="text-xs text-muted">
                  {t('versionInfo', { version: v.version, date: format.dateTime(new Date(v.createdAt), { dateStyle: 'medium', timeStyle: 'short' }) })}
                </p>
                <p className="whitespace-pre-wrap text-foreground">{v.content}</p>
              </li>
            ))}
          </ol>
        )
      ) : null}
    </div>
  );
}
