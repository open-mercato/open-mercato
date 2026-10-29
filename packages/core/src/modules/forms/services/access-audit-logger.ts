import type { EntityManager } from '@mikro-orm/postgresql'
import { FormAccessAudit, type FormAccessAuditPurpose } from '../data/entities'

/**
 * Phase 2b — admin-surface access audit (T7 compliance polish).
 *
 * Writes one row per admin read or audit-bearing mutation against a
 * submission. Runtime (patient) reads of one's own submission do NOT call
 * this logger (R1 posture per phase 1c spec).
 *
 * Two write postures, selected by `FORMS_ACCESS_AUDIT_BATCH_MS`:
 *
 *   - `0` (default for tests / deterministic admin reads) ⇒ synchronous mode:
 *     each `log(em, event)` inserts + flushes immediately on the request's own
 *     EntityManager (the original phase 2b behaviour, preserved verbatim).
 *
 *   - `> 0` ⇒ async-batched mode: events are buffered in a module-level
 *     singleton queue and flushed as a single bulk insert on a timer (every
 *     `FORMS_ACCESS_AUDIT_BATCH_MS`) or when the buffer hits a size cap. The
 *     request `em` is request-scoped and likely gone by flush time, so the
 *     flusher forks a FRESH EntityManager from a captured factory. Every scope
 *     field needed to write the row is captured on the buffered event at
 *     enqueue time — nothing is read back from the (possibly disposed) request
 *     context at flush time.
 *
 * Fail-soft everywhere: a failed insert (sync or batched) is logged and
 * swallowed. An audit write MUST NEVER break the read it accompanies.
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

type BufferedAuditEvent = AccessAuditEvent & { accessedAt: Date }

type AuditLoggerLogger = {
  warn?: (data: Record<string, unknown>, message: string) => void
}

export type BatchingAccessAuditLoggerOptions = {
  /**
   * Forks a fresh EntityManager for the deferred bulk insert. MUST return an
   * EM bound to the same ORM the request used (e.g. `(await getOrm()).em.fork()`).
   * Synchronous mode never calls this.
   */
  emFactory: () => Promise<EntityManager> | EntityManager
  /** Flush interval in ms. `0` ⇒ synchronous mode (no buffering, no timer). */
  batchMs: number
  /** Flush early once the buffer reaches this many events. Default 100. */
  maxBufferSize?: number
  /** Optional structured logger for fail-soft diagnostics. */
  logger?: AuditLoggerLogger
  /** Override the clock for tests. */
  now?: () => Date
}

const DEFAULT_MAX_BUFFER_SIZE = 100

/**
 * Async-batched access audit logger.
 *
 * Architectural note: the DI container is request-scoped, so this logger is
 * registered once per request. To make batching span requests it is backed by
 * a MODULE-LEVEL singleton buffer + timer (the static members below). All
 * request-scoped instances share that buffer and the fresh-EM factory captured
 * by the first instance, so events from many requests coalesce into one bulk
 * insert. In synchronous mode (`batchMs === 0`) the singleton is never touched.
 */
export class BatchingAccessAuditLogger implements AccessAuditLogger {
  private static buffer: BufferedAuditEvent[] = []
  private static timer: ReturnType<typeof setTimeout> | null = null
  private static flushing: Promise<void> | null = null
  private static activeEmFactory: BatchingAccessAuditLoggerOptions['emFactory'] | null = null
  private static activeLogger: AuditLoggerLogger | undefined

  private readonly emFactory: BatchingAccessAuditLoggerOptions['emFactory']
  private readonly batchMs: number
  private readonly maxBufferSize: number
  private readonly logger?: AuditLoggerLogger
  private readonly now: () => Date

  constructor(options: BatchingAccessAuditLoggerOptions) {
    this.emFactory = options.emFactory
    this.batchMs = Number.isFinite(options.batchMs) && options.batchMs > 0 ? Math.floor(options.batchMs) : 0
    this.maxBufferSize =
      options.maxBufferSize && options.maxBufferSize > 0 ? Math.floor(options.maxBufferSize) : DEFAULT_MAX_BUFFER_SIZE
    this.logger = options.logger
    this.now = options.now ?? (() => new Date())
  }

  async log(em: EntityManager, event: AccessAuditEvent): Promise<void> {
    if (this.batchMs === 0) {
      await this.writeSync(em, event)
      return
    }
    this.enqueue(event)
  }

  /** Buffers a single event (non-blocking) and arms the flush timer. */
  private enqueue(event: AccessAuditEvent): void {
    BatchingAccessAuditLogger.activeEmFactory = this.emFactory
    BatchingAccessAuditLogger.activeLogger = this.logger
    BatchingAccessAuditLogger.buffer.push({ ...event, accessedAt: this.now() })

    if (BatchingAccessAuditLogger.buffer.length >= this.maxBufferSize) {
      void this.flush()
      return
    }
    if (BatchingAccessAuditLogger.timer === null) {
      BatchingAccessAuditLogger.timer = setTimeout(() => {
        void this.flush()
      }, this.batchMs)
      // Never keep the process alive for a pending audit flush.
      const timer = BatchingAccessAuditLogger.timer as unknown as { unref?: () => void }
      timer.unref?.()
    }
  }

  /**
   * Drains the shared buffer and persists it as a single bulk insert on a fresh
   * EM. Idempotent w.r.t. concurrent callers: a single in-flight flush is shared.
   * Fail-soft — a failed insert is logged and the events are dropped (audit is
   * best-effort; correctness never blocks a read).
   */
  async flush(): Promise<void> {
    if (BatchingAccessAuditLogger.timer !== null) {
      clearTimeout(BatchingAccessAuditLogger.timer)
      BatchingAccessAuditLogger.timer = null
    }
    if (BatchingAccessAuditLogger.flushing) {
      await BatchingAccessAuditLogger.flushing
      // A second drain in case events landed during the awaited flush.
      if (BatchingAccessAuditLogger.buffer.length === 0) return
    }

    const run = this.drain()
    BatchingAccessAuditLogger.flushing = run
    try {
      await run
    } finally {
      if (BatchingAccessAuditLogger.flushing === run) {
        BatchingAccessAuditLogger.flushing = null
      }
    }
  }

  private async drain(): Promise<void> {
    const batch = BatchingAccessAuditLogger.buffer.splice(0, BatchingAccessAuditLogger.buffer.length)
    if (batch.length === 0) return

    const factory = BatchingAccessAuditLogger.activeEmFactory ?? this.emFactory
    try {
      const em = await factory()
      for (const event of batch) {
        em.persist(
          em.create(FormAccessAudit, {
            organizationId: event.organizationId,
            submissionId: event.submissionId,
            accessedBy: event.accessedBy,
            accessPurpose: event.accessPurpose,
            ip: event.ip ?? null,
            ua: event.ua ?? null,
            revisionId: event.revisionId ?? null,
            accessedAt: event.accessedAt,
          }),
        )
      }
      await em.flush()
    } catch (error) {
      const logger = BatchingAccessAuditLogger.activeLogger ?? this.logger
      logger?.warn?.(
        {
          event: 'forms.access_audit.flush_failed',
          dropped: batch.length,
          message: error instanceof Error ? error.message : 'Unknown audit flush error',
        },
        'forms access-audit batch flush failed (events dropped)',
      )
    }
  }

  private async writeSync(em: EntityManager, event: AccessAuditEvent): Promise<void> {
    try {
      const row = em.create(FormAccessAudit, {
        organizationId: event.organizationId,
        submissionId: event.submissionId,
        accessedBy: event.accessedBy,
        accessPurpose: event.accessPurpose,
        ip: event.ip ?? null,
        ua: event.ua ?? null,
        revisionId: event.revisionId ?? null,
        accessedAt: this.now(),
      })
      em.persist(row)
      await em.flush()
    } catch (error) {
      this.logger?.warn?.(
        {
          event: 'forms.access_audit.write_failed',
          submissionId: event.submissionId,
          message: error instanceof Error ? error.message : 'Unknown audit write error',
        },
        'forms access-audit synchronous write failed (swallowed)',
      )
    }
  }

  /** Test-only: number of events currently buffered (shared singleton). */
  static get bufferedCount(): number {
    return BatchingAccessAuditLogger.buffer.length
  }

  /** Test-only: drop buffered events + timer without persisting. */
  static reset(): void {
    if (BatchingAccessAuditLogger.timer !== null) {
      clearTimeout(BatchingAccessAuditLogger.timer)
      BatchingAccessAuditLogger.timer = null
    }
    BatchingAccessAuditLogger.buffer = []
    BatchingAccessAuditLogger.flushing = null
    BatchingAccessAuditLogger.activeEmFactory = null
    BatchingAccessAuditLogger.activeLogger = undefined
  }
}

/**
 * Synchronous access audit logger (legacy / `FORMS_ACCESS_AUDIT_BATCH_MS=0`).
 * Each call inserts + flushes immediately on the request's own EntityManager.
 * Retained as a standalone implementation so callers/tests can opt into
 * deterministic synchronous behaviour without constructing the batching logger.
 */
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

/**
 * Resolves `FORMS_ACCESS_AUDIT_BATCH_MS` from env. Default `0` (synchronous) so
 * existing tests and deterministic admin reads keep today's behaviour. Any
 * positive integer enables async-batched writes with that flush interval.
 */
export function resolveAccessAuditBatchMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.FORMS_ACCESS_AUDIT_BATCH_MS
  if (raw == null || raw.trim() === '') return 0
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return parsed
}
