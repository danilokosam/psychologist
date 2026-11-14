import type { Tx } from '../db/tenant-context';
import type { AuditEntry, AuditTrail } from './audit-trail';

/**
 * Writes with `createMany`, which issues a plain INSERT without RETURNING:
 * app_runtime has INSERT but deliberately no SELECT on audit_logs, so the
 * application can append to the trail but never read or alter it.
 */
export class PrismaAuditTrail implements AuditTrail {
  constructor(private readonly tx: Tx) {}

  async record(entries: AuditEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.tx.auditLog.createMany({
      data: entries.map((entry) => ({
        organizationId: entry.organizationId,
        actorUserId: entry.actorUserId,
        action: entry.action,
        resourceType: entry.resourceType,
        resourceId: entry.resourceId,
        metadata: entry.metadata ?? {},
      })),
    });
  }
}
