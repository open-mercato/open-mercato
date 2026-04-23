import type { EntityManager } from '@mikro-orm/postgresql'
import { type Kysely, sql } from 'kysely'

export type IndexerErrorSource = 'query_index' | 'vector' | 'fulltext'

export type RecordIndexerErrorInput = {
  source: IndexerErrorSource
  handler: string
  error: unknown
  entityType?: string | null
  recordId?: string | null
  tenantId?: string | null
  organizationId?: string | null
  payload?: unknown
}

type RecordIndexerErrorDeps = {
  em?: EntityManager
  db?: Kysely<any>
}

const MAX_MESSAGE_LENGTH = 8_192
const MAX_STACK_LENGTH = 32_768

function truncate(input: string | null | undefined, limit: number): string | null {
  if (!input) return null
  return input.length > limit ? `${input.slice(0, limit - 3)}...` : input
}

function normalizeError(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name || 'Unknown error',
      stack: typeof error.stack === 'string' ? error.stack : null,
    }
  }
  if (typeof error === 'string') {
    return { message: error, stack: null }
  }
  try {
    const json = JSON.stringify(error)
    return { message: json, stack: null }
  } catch {
    return { message: String(error ?? 'Unknown error'), stack: null }
  }
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

function pickDb(deps: RecordIndexerErrorDeps): Kysely<any> | null {
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

export async function recordIndexerError(deps: RecordIndexerErrorDeps, input: RecordIndexerErrorInput): Promise<void> {
  const db = pickDb(deps)
  if (!db) {
    console.error('[indexers] Unable to record indexer error (missing db connection)', {
      source: input.source,
      handler: input.handler,
    })
    return
  }

  const { message, stack } = normalizeError(input.error)
  const payload = safeJson(input.payload)
  const now = new Date()

  try {
    await db
      .insertInto('indexer_error_logs' as any)
      .values({
        source: input.source,
        handler: input.handler,
        entity_type: input.entityType ?? null,
        record_id: input.recordId ?? null,
        tenant_id: input.tenantId ?? null,
        organization_id: input.organizationId ?? null,
        payload: payload === null ? null : sql`${JSON.stringify(payload)}::jsonb`,
        message: truncate(message, MAX_MESSAGE_LENGTH),
        stack: truncate(stack, MAX_STACK_LENGTH),
        occurred_at: now,
      } as any)
      .execute()
  } catch (loggingError) {
    console.error('[indexers] Failed to persist indexer error', loggingError)
  }
}
