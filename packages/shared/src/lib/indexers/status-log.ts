import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'
import type { IndexerErrorSource } from './error-log'

export type IndexerLogLevel = 'info' | 'warn'

export type RecordIndexerLogInput = {
  source: IndexerErrorSource
  handler: string
  message: string
  level?: IndexerLogLevel
  entityType?: string | null
  recordId?: string | null
  tenantId?: string | null
  organizationId?: string | null
  details?: unknown
}

type RecordIndexerLogDeps = {
  em?: EntityManager
  db?: Kysely<any>
}

const MAX_MESSAGE_LENGTH = 4_096
const MAX_DELETE_BATCH = 5_000
const MAX_LOGS_PER_SOURCE = 10_000

function truncate(input: string | null | undefined, limit: number): string | null {
  if (!input) return null
  return input.length > limit ? `${input.slice(0, limit - 3)}...` : input
}

function safeJson(value: unknown): unknown {
  if (value === undefined) return null
  try {
    return JSON.parse(JSON.stringify(value))
  } catch {
    if (value == null) return null
    if (typeof value === 'object') {
      return { note: 'unserializable', asString: String(value) }
    }
    return value
  }
}

function pickDb(deps: RecordIndexerLogDeps): Kysely<any> | null {
  if (deps.db) return deps.db
  if (deps.em) {
    try {
      return deps.em.getKysely<any>()
    } catch {
      return null
    }
  }
  return null
}

/**
 * Indexer status logging is best-effort observability and must never ride on —
 * or be noisy about — the caller's transaction lifecycle. When index maintenance
 * runs inline on a request `em` (e.g. an inline force reindex that emits the
 * vector-purge subscriber), the captured Kysely can be a transaction handle that
 * has already committed/rolled back, so a follow-up read/write throws
 * "Transaction is already committed". Treat that class of error as a quiet skip
 * rather than an error the operator must triage. A fresh-EM path (the events
 * worker) never hits this; this guard only de-noises the inline path.
 */
function isInactiveTransactionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return /transaction is already (committed|rolled back)/i.test(message)
}

async function pruneExcessLogs(db: Kysely<any>, source: IndexerErrorSource): Promise<void> {
  const rows = await db
    .selectFrom('indexer_status_logs' as any)
    .select('id' as any)
    .where('source' as any, '=', source)
    .orderBy('occurred_at' as any, 'desc')
    .orderBy('id' as any, 'desc')
    .offset(MAX_LOGS_PER_SOURCE)
    .limit(MAX_DELETE_BATCH)
    .execute()

  if (!rows.length) return
  const ids = rows.map((row: any) => row.id).filter(Boolean)
  if (!ids.length) return
  await db
    .deleteFrom('indexer_status_logs' as any)
    .where('id' as any, 'in', ids)
    .execute()
}

export async function recordIndexerLog(
  deps: RecordIndexerLogDeps,
  input: RecordIndexerLogInput,
): Promise<void> {
  const db = pickDb(deps)
  if (!db) {
    console.warn('[indexers] Unable to record indexer log (missing db connection)', {
      source: input.source,
      handler: input.handler,
    })
    return
  }

  const level: IndexerLogLevel = input.level === 'warn' ? 'warn' : 'info'
  const message = truncate(input.message, MAX_MESSAGE_LENGTH) ?? '—'
  const details = safeJson(input.details)
  const occurredAt = new Date()

  try {
    await db
      .insertInto('indexer_status_logs' as any)
      .values({
        source: input.source,
        handler: input.handler,
        level,
        entity_type: input.entityType ?? null,
        record_id: input.recordId ?? null,
        tenant_id: input.tenantId ?? null,
        organization_id: input.organizationId ?? null,
        message,
        details: details === null ? null : sql`${JSON.stringify(details)}::jsonb`,
        occurred_at: occurredAt,
      } as any)
      .execute()
  } catch (error) {
    // A committed/rolled-back caller transaction is an expected, harmless
    // condition for best-effort logging — skip quietly instead of surfacing it.
    if (!isInactiveTransactionError(error)) {
      console.error('[indexers] Failed to persist indexer log', error)
    }
    return
  }

  try {
    await pruneExcessLogs(db, input.source)
  } catch (pruneError) {
    if (!isInactiveTransactionError(pruneError)) {
      console.warn('[indexers] Failed to prune indexer logs', pruneError)
    }
  }
}
