import type { EntityManager } from '@mikro-orm/postgresql'
import { FormAccessAudit, type FormAccessAuditPurpose } from '../data/entities'

/**
 * Phase 2b — admin-surface access audit.
 *
 * Writes one row per admin read or audit-bearing mutation against a
 * submission. Runtime (patient) reads of one's own submission do NOT call
 * this logger (R1 posture per phase 1c spec).
 *
 * The implementation here is intentionally synchronous: each call inserts
 * + flushes immediately. The phase 2b spec calls for async-batched writes
 * with a flush interval (`FORMS_ACCESS_AUDIT_BATCH_MS`), which is a
 * straightforward swap if/when the queue strategy lands. The current
 * implementation never drops rows and has no in-memory buffer to lose on
 * crash — adequate for compliance correctness; the optimization is purely
 * performance.
 */
export type AccessAuditEvent = {
  organizationId: string
  submissionId: string
  accessedBy: string
  accessPurpose: FormAccessAuditPurpose
  ip?: string | null
  ua?: string | null
  revisionId?: string | null
}

export interface AccessAuditLogger {
  log(em: EntityManager, event: AccessAuditEvent): Promise<void>
}

export class FormsAccessAuditLogger implements AccessAuditLogger {
  async log(em: EntityManager, event: AccessAuditEvent): Promise<void> {
    const row = em.create(FormAccessAudit, {
      organizationId: event.organizationId,
      submissionId: event.submissionId,
      accessedBy: event.accessedBy,
      accessPurpose: event.accessPurpose,
      ip: event.ip ?? null,
      ua: event.ua ?? null,
      revisionId: event.revisionId ?? null,
      accessedAt: new Date(),
    })
    em.persist(row)
    await em.flush()
  }
}

export class NoopAccessAuditLogger implements AccessAuditLogger {
  async log(): Promise<void> {
    /* no-op — used in tests and contexts where audit is intentionally suppressed */
  }
}
