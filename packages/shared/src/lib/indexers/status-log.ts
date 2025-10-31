import type { EntityManager } from '@mikro-orm/postgresql'
import type { Knex } from 'knex'
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
  knex?: Knex
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

function pickKnex(deps: RecordIndexerLogDeps): Knex | null {
  if (deps.knex) return deps.knex
  if (deps.em) {
    try {
      const connection = deps.em.getConnection()
      if (connection && typeof connection.getKnex === 'function') {
        return connection.getKnex()
      }
    } catch {
      return null
    }
  }
  return null
}

async function pruneExcessLogs(knex: Knex, source: IndexerErrorSource): Promise<void> {
  const rows = await knex('indexer_status_logs')
    .select('id')
    .where('source', source)
    .orderBy('occurred_at', 'desc')
    .orderBy('id', 'desc')
    .offset(MAX_LOGS_PER_SOURCE)
    .limit(MAX_DELETE_BATCH)

  if (!rows.length) return
  const ids = rows.map((row: any) => row.id).filter(Boolean)
  if (!ids.length) return
  await knex('indexer_status_logs')
    .whereIn('id', ids)
    .del()
}

export async function recordIndexerLog(
  deps: RecordIndexerLogDeps,
  input: RecordIndexerLogInput,
): Promise<void> {
  const knex = pickKnex(deps)
  if (!knex) {
    console.warn('[indexers] Unable to record indexer log (missing knex connection)', {
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
    await knex('indexer_status_logs').insert({
      source: input.source,
      handler: input.handler,
      level,
      entity_type: input.entityType ?? null,
      record_id: input.recordId ?? null,
      tenant_id: input.tenantId ?? null,
      organization_id: input.organizationId ?? null,
      message,
      details,
      occurred_at: occurredAt,
    })
  } catch (error) {
    console.error('[indexers] Failed to persist indexer log', error)
    return
  }

  try {
    await pruneExcessLogs(knex, input.source)
  } catch (pruneError) {
    console.warn('[indexers] Failed to prune indexer logs', pruneError)
  }
}
