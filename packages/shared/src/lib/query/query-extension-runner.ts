/**
 * Query Extension Runner
 *
 * Shared pipeline runner for both BasicQueryEngine and HybridQueryEngine.
 * Handles:
 *  1. Sync before-query events (can block / modify query)
 *  2. Scope guard re-application after modifications
 *  3. Query-level enricher application
 *  4. Sync after-query events (can modify result)
 */

import type { SyncSubscriberEntry } from '../crud/sync-subscriber-store'
import { getAllSyncSubscribers } from '../crud/sync-subscriber-store'
import { collectSyncSubscribers, matchesEventPattern } from '../crud/sync-event-runner'
import type { EnricherContext } from '../crud/response-enricher'
import type { EnricherSurfaceSelector } from '../crud/enricher-registry'
import { getEnrichersForEntity } from '../crud/enricher-registry'
import { applyResponseEnrichers, applyResponseEnricherToRecord } from '../crud/enricher-runner'
import type { SyncQueryEventPayload, SyncQueryEventResult } from './sync-query-event-types'
import type { QueryOptions, QueryResult } from './types'

// ---------------------------------------------------------------------------
// Entity-to-event-ID helpers
// ---------------------------------------------------------------------------

function toQueryingEventId(entity: string): string {
  return `${entity}.querying`
}

function toQueriedEventId(entity: string): string {
  return `${entity}.queried`
}

/**
 * Convert an entity identifier from query engine format (`module:entity`)
 * to event format (`module.entity`).
 */
export function entityIdToEventEntity(entityId: string): string {
  return entityId.replace(/:/g, '.')
}

// ---------------------------------------------------------------------------
// Collect query-event subscribers
// ---------------------------------------------------------------------------

export function collectQuerySubscribers(
  eventId: string,
): SyncSubscriberEntry[] {
  const allSync = getAllSyncSubscribers()
  return allSync
    .filter((s) => matchesEventPattern(s.metadata.event, eventId))
    .sort((a, b) => (a.metadata.priority ?? 50) - (b.metadata.priority ?? 50))
}

// ---------------------------------------------------------------------------
// Before-query event runner
// ---------------------------------------------------------------------------

export interface BeforeQueryResult {
  ok: boolean
  errorMessage?: string
  errorStatus?: number
  modifiedQuery?: Partial<QueryOptions>
}

export async function runBeforeQueryEvent(
  payload: SyncQueryEventPayload,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<BeforeQueryResult> {
  const eventId = toQueryingEventId(payload.entity)
  const subscribers = collectQuerySubscribers(eventId)

  if (subscribers.length === 0) {
    return { ok: true }
  }

  let currentQuery = payload.query

  for (const subscriber of subscribers) {
    try {
      const result = await subscriber.handler(
        { ...payload, eventId, query: currentQuery } as never,
        ctx,
      )
      const queryResult = result as SyncQueryEventResult | void

      if (queryResult?.ok === false) {
        return {
          ok: false,
          errorMessage: queryResult.message ?? 'Query blocked by subscriber',
          errorStatus: queryResult.status ?? 422,
        }
      }

      if (queryResult?.modifiedQuery) {
        currentQuery = { ...currentQuery, ...queryResult.modifiedQuery }
      }
    } catch (error) {
      console.error(
        `[query-extension] before-query subscriber failed: ${subscriber.metadata.id}`,
        error,
      )
      return {
        ok: false,
        errorMessage: `Subscriber ${subscriber.metadata.id} threw unexpectedly`,
        errorStatus: 500,
      }
    }
  }

  const queryChanged = currentQuery !== payload.query
  return {
    ok: true,
    modifiedQuery: queryChanged ? currentQuery : undefined,
  }
}

// ---------------------------------------------------------------------------
// After-query event runner
// ---------------------------------------------------------------------------

export interface AfterQueryResult {
  modifiedResult?: QueryResult<Record<string, unknown>>
}

export async function runAfterQueryEvent(
  payload: SyncQueryEventPayload,
  ctx: { resolve: <T = unknown>(name: string) => T },
): Promise<AfterQueryResult> {
  const eventId = toQueriedEventId(payload.entity)
  const subscribers = collectQuerySubscribers(eventId)

  if (subscribers.length === 0) {
    return {}
  }

  let currentResult = payload.result

  for (const subscriber of subscribers) {
    try {
      const result = await subscriber.handler(
        { ...payload, eventId, result: currentResult } as never,
        ctx,
      )
      const queryResult = result as SyncQueryEventResult | void

      if (queryResult?.modifiedResult) {
        if (isValidQueryResult(queryResult.modifiedResult)) {
          currentResult = queryResult.modifiedResult
        } else {
          console.warn(
            `[query-extension] after-query subscriber ${subscriber.metadata.id} returned invalid modifiedResult shape — ignored`,
          )
        }
      }
    } catch (error) {
      console.error(
        `[query-extension] after-query subscriber failed: ${subscriber.metadata.id}`,
        error,
      )
    }
  }

  const resultChanged = currentResult !== payload.result
  return {
    modifiedResult: resultChanged ? currentResult : undefined,
  }
}

// ---------------------------------------------------------------------------
// Query result validation
// ---------------------------------------------------------------------------

function isValidQueryResult(value: unknown): value is QueryResult<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.page === 'number' &&
    typeof candidate.pageSize === 'number' &&
    typeof candidate.total === 'number'
  )
}

// ---------------------------------------------------------------------------
// Scope guard re-application
// ---------------------------------------------------------------------------

export function reapplyScopeGuards(
  query: QueryOptions,
  tenantId: string,
  organizationId?: string | null,
): QueryOptions {
  return {
    ...query,
    tenantId,
    ...(organizationId != null ? { organizationId } : {}),
  }
}

// ---------------------------------------------------------------------------
// Query-level enricher application
// ---------------------------------------------------------------------------

export async function applyQueryLevelEnrichers<T extends Record<string, unknown>>(
  items: T[],
  entity: string,
  engine: 'basic' | 'hybrid',
  context: EnricherContext,
  mode: 'list' | 'detail' = 'list',
): Promise<{ items: T[]; enrichedBy: string[]; enricherErrors: string[] }> {
  const selector: EnricherSurfaceSelector = {
    surface: 'query-engine',
    engine,
  }

  const entries = getEnrichersForEntity(entity, selector)

  const filteredEntries = entries.filter((entry) => {
    const applyOn = entry.enricher.queryEngine?.applyOn ?? ['list', 'detail']
    return applyOn.includes(mode)
  })

  if (filteredEntries.length === 0) {
    return { items, enrichedBy: [], enricherErrors: [] }
  }

  if (mode === 'detail' && items.length === 1) {
    const singleResult = await applyResponseEnricherToRecord(items[0], entity, context, filteredEntries)
    return {
      items: [singleResult.record as T],
      enrichedBy: singleResult._meta.enrichedBy,
      enricherErrors: singleResult._meta.enricherErrors ?? [],
    }
  }

  const result = await applyResponseEnrichers(items, entity, context, filteredEntries)
  return {
    items: result.items as T[],
    enrichedBy: result._meta.enrichedBy,
    enricherErrors: result._meta.enricherErrors ?? [],
  }
}

// ---------------------------------------------------------------------------
// Full pipeline orchestrator
// ---------------------------------------------------------------------------

export interface QueryExtensionContext {
  entity: string
  engine: 'basic' | 'hybrid'
  tenantId: string
  organizationId?: string | null
  userId?: string
  em: unknown
  container?: unknown
  userFeatures?: string[]
}

export interface QueryExtensionPipelineResult<T> {
  blocked: boolean
  errorMessage?: string
  errorStatus?: number
  modifiedQuery?: QueryOptions
  finalResult?: QueryResult<T>
}

/**
 * Run the before-query phase of the extension pipeline.
 *
 * 1. Emit sync before-query event (can block / modify query)
 * 2. Re-apply mandatory scope guards after modifications
 */
export async function runBeforeQueryPipeline(
  query: QueryOptions,
  extensionCtx: QueryExtensionContext,
  diCtx: { resolve: <T = unknown>(name: string) => T },
): Promise<{ blocked: boolean; errorMessage?: string; errorStatus?: number; query: QueryOptions }> {
  const eventEntity = entityIdToEventEntity(extensionCtx.entity)

  const beforePayload: SyncQueryEventPayload = {
    eventId: toQueryingEventId(eventEntity),
    entity: eventEntity,
    timing: 'before',
    engine: extensionCtx.engine,
    query,
    userId: extensionCtx.userId,
    organizationId: extensionCtx.organizationId,
    tenantId: extensionCtx.tenantId,
    em: extensionCtx.em as never,
  }

  const beforeResult = await runBeforeQueryEvent(beforePayload, diCtx)

  if (!beforeResult.ok) {
    return {
      blocked: true,
      errorMessage: beforeResult.errorMessage,
      errorStatus: beforeResult.errorStatus,
      query,
    }
  }

  let effectiveQuery = beforeResult.modifiedQuery
    ? { ...query, ...beforeResult.modifiedQuery }
    : query

  effectiveQuery = reapplyScopeGuards(
    effectiveQuery,
    extensionCtx.tenantId,
    extensionCtx.organizationId,
  )

  return { blocked: false, query: effectiveQuery }
}

/**
 * Run the after-query phase of the extension pipeline.
 *
 * 1. Apply query-level enrichers (opt-in only)
 * 2. Emit sync after-query event (can modify result)
 */
export async function runAfterQueryPipeline<T extends Record<string, unknown>>(
  result: QueryResult<T>,
  query: QueryOptions,
  extensionCtx: QueryExtensionContext,
  diCtx: { resolve: <T = unknown>(name: string) => T },
): Promise<QueryResult<T>> {
  const eventEntity = entityIdToEventEntity(extensionCtx.entity)
  let currentResult: QueryResult<Record<string, unknown>> = result as QueryResult<Record<string, unknown>>

  const enricherContext: EnricherContext = {
    organizationId: extensionCtx.organizationId ?? '',
    tenantId: extensionCtx.tenantId,
    userId: extensionCtx.userId ?? '',
    em: extensionCtx.em,
    container: extensionCtx.container,
    userFeatures: extensionCtx.userFeatures,
  }

  const mode = currentResult.items.length === 1 ? 'detail' : 'list'
  const enrichResult = await applyQueryLevelEnrichers(
    currentResult.items,
    eventEntity,
    extensionCtx.engine,
    enricherContext,
    mode,
  )

  currentResult = { ...currentResult, items: enrichResult.items }

  const afterPayload: SyncQueryEventPayload = {
    eventId: toQueriedEventId(eventEntity),
    entity: eventEntity,
    timing: 'after',
    engine: extensionCtx.engine,
    query,
    result: currentResult,
    userId: extensionCtx.userId,
    organizationId: extensionCtx.organizationId,
    tenantId: extensionCtx.tenantId,
    em: extensionCtx.em as never,
  }

  const afterResult = await runAfterQueryEvent(afterPayload, diCtx)

  if (afterResult.modifiedResult) {
    currentResult = afterResult.modifiedResult
  }

  return currentResult as QueryResult<T>
}
