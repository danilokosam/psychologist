/**
 * F-012. Records who did what to which resource. Implementations write in the
 * caller's transaction, so the record and the action it describes commit or
 * roll back together: if the audit write fails, the read or write it was
 * auditing fails too (fail closed).
 *
 * `metadata` is for identifiers and counters only (version numbers). NEVER
 * put clinical content, names or free text in it -- the trail must not
 * become a second copy of the data it protects.
 */
export type AuditEntry = {
  organizationId: string;
  actorUserId: string;
  action: AuditAction;
  resourceType: 'clinical_note';
  resourceId: string;
  metadata?: Record<string, number | string | boolean>;
};

export type AuditAction =
  | 'clinical_note.read'
  | 'clinical_note.create'
  | 'clinical_note.revise'
  | 'clinical_note.history_read';

export interface AuditTrail {
  record(entries: AuditEntry[]): Promise<void>;
}
