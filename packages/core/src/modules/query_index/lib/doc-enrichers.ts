import type { Kysely } from 'kysely'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { recordIndexerError } from '@open-mercato/shared/lib/indexers/error-log'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('query_index').child({ component: 'doc-enrichers' })

/**
 * Index-document enrichment — lets the module that owns an entity contribute computed keys to
 * that entity's `entity_indexes.doc` at index time (Storefront Public API §3.3, decision D9).
 *
 * Registration is programmatic (call `registerIndexDocEnricher` from the owning module's `di.ts`);
 * there is no auto-discovered module file for it.
 *
 * Key namespace: every enricher declares the exact keys it writes. A key MUST be a lowercase
 * snake_case identifier (`^[a-z][a-z0-9_]*$`), so it can never collide with `cf:*` custom-field
 * keys or `l10n:*` translation keys, MUST NOT be one of the reserved document keys, and MUST NOT be
 * declared by another enricher of the same entity type. A key that turns out to be a base column
 * of the indexed row is a collision detected at index time: the base value is kept, the
 * contribution is discarded and the error is recorded.
 *
 * Failure semantics (fail closed, detectable): when an enricher throws, or returns nothing for a
 * record, every key it declares is written as JSON `null` on the affected documents. Consumers
 * MUST treat `null` (and an absent key) as "not indexed" — never as "empty". Indexing itself
 * never fails because of an enricher.
 *
 * Enriched keys are filter/projection data: they are excluded from the `search_text` aggregate
 * and from `search_tokens`.
 */
export type IndexDocEnricherContext = {
  db: Kysely<any>
  entityType: string
  tenantId: string | null
  organizationId: string | null
}

export type IndexDocEnricherRecord = {
  recordId: string
  doc: Readonly<Record<string, unknown>>
}

export type IndexDocEnrichment = Record<string, unknown>

export type IndexDocEnricher = {
  id: string
  entityType: string
  keys: readonly string[]
  enrich: (
    records: readonly IndexDocEnricherRecord[],
    ctx: IndexDocEnricherContext,
  ) => Promise<Map<string, IndexDocEnrichment>>
}

export type IndexDocEnrichmentTarget = {
  recordId: string
  doc: Record<string, unknown>
  tenantId: string | null
  organizationId: string | null
}

export const INDEX_DOC_ENRICHER_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

export const RESERVED_INDEX_DOC_KEYS: ReadonlySet<string> = new Set([
  'id',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
  'deleted_at',
  'search_text',
])

type RegisteredEnricher = IndexDocEnricher & { keys: string[] }

type EnricherRegistryState = {
  byEntityType: Map<string, RegisteredEnricher[]>
}

const GLOBAL_ENRICHER_REGISTRY_KEY = '__openMercatoQueryIndexDocEnrichers__' as const

type GlobalEnricherRegistry = typeof globalThis & {
  [GLOBAL_ENRICHER_REGISTRY_KEY]?: EnricherRegistryState
}

function getRegistryState(): EnricherRegistryState {
  const globalRegistry = globalThis as GlobalEnricherRegistry
  if (!globalRegistry[GLOBAL_ENRICHER_REGISTRY_KEY]) {
    globalRegistry[GLOBAL_ENRICHER_REGISTRY_KEY] = { byEntityType: new Map() }
  }
  return globalRegistry[GLOBAL_ENRICHER_REGISTRY_KEY]
}

function validateEnricher(enricher: IndexDocEnricher, existing: readonly RegisteredEnricher[]): string[] {
  if (typeof enricher.id !== 'string' || !enricher.id.trim()) {
    throw new Error('[internal] Index doc enricher requires a non-empty id')
  }
  if (typeof enricher.entityType !== 'string' || !enricher.entityType.includes(':')) {
    throw new Error(`[internal] Index doc enricher "${enricher.id}" requires an entityType in '<module>:<entity>' form`)
  }
  if (typeof enricher.enrich !== 'function') {
    throw new Error(`[internal] Index doc enricher "${enricher.id}" requires an enrich function`)
  }
  const keys = Array.from(new Set(enricher.keys ?? []))
  if (!keys.length) {
    throw new Error(`[internal] Index doc enricher "${enricher.id}" must declare at least one key`)
  }
  for (const key of keys) {
    if (!INDEX_DOC_ENRICHER_KEY_PATTERN.test(key)) {
      throw new Error(`[internal] Index doc enricher "${enricher.id}" key "${key}" must match ${INDEX_DOC_ENRICHER_KEY_PATTERN}`)
    }
    if (RESERVED_INDEX_DOC_KEYS.has(key)) {
      throw new Error(`[internal] Index doc enricher "${enricher.id}" key "${key}" is reserved`)
    }
    const owner = existing.find((entry) => entry.id !== enricher.id && entry.keys.includes(key))
    if (owner) {
      throw new Error(`[internal] Index doc enricher "${enricher.id}" key "${key}" is already contributed by "${owner.id}" for ${enricher.entityType}`)
    }
  }
  return keys
}

/**
 * Registers an enricher. Re-registering the same `id` for the same entity type replaces the
 * previous registration (HMR-safe). Throws on an invalid or colliding key declaration.
 * Returns a function that removes the registration.
 */
export function registerIndexDocEnricher(enricher: IndexDocEnricher): () => void {
  const state = getRegistryState()
  const existing = state.byEntityType.get(enricher.entityType) ?? []
  const keys = validateEnricher(enricher, existing)
  const registered: RegisteredEnricher = { ...enricher, keys }
  const next = existing.filter((entry) => entry.id !== enricher.id)
  next.push(registered)
  state.byEntityType.set(enricher.entityType, next)
  return () => {
    const current = state.byEntityType.get(enricher.entityType) ?? []
    const remaining = current.filter((entry) => entry !== registered)
    if (remaining.length) state.byEntityType.set(enricher.entityType, remaining)
    else state.byEntityType.delete(enricher.entityType)
  }
}

export function getIndexDocEnrichers(entityType: string): readonly IndexDocEnricher[] {
  return getRegistryState().byEntityType.get(entityType) ?? []
}

export function hasIndexDocEnrichers(entityType: string): boolean {
  return (getRegistryState().byEntityType.get(entityType)?.length ?? 0) > 0
}

export function isIndexDocEnrichedKey(entityType: string | null | undefined, field: string): boolean {
  if (!entityType) return false
  const enrichers = getRegistryState().byEntityType.get(entityType)
  if (!enrichers) return false
  return enrichers.some((entry) => entry.keys.includes(field))
}

export function resetIndexDocEnrichers(): void {
  getRegistryState().byEntityType.clear()
}

function scopeGroupKey(target: IndexDocEnrichmentTarget): string {
  return `${target.tenantId ?? ''}|${target.organizationId ?? ''}`
}

async function reportEnricherFailure(
  db: Kysely<any>,
  input: {
    enricher: RegisteredEnricher
    entityType: string
    tenantId: string | null
    organizationId: string | null
    recordId?: string
    error: unknown
    handler: string
    details?: Record<string, unknown>
  },
): Promise<void> {
  logger.error('Index doc enricher failed; contributed keys written as null', {
    enricherId: input.enricher.id,
    entityType: input.entityType,
    tenantId: input.tenantId,
    organizationId: input.organizationId,
    recordId: input.recordId ?? null,
    ...input.details,
    err: input.error,
  })
  getTelemetryRuntime()?.reportError(input.error, {
    module: 'query_index',
    code: 'query_index.doc_enricher_failed',
  })
  await recordIndexerError(
    { db },
    {
      source: 'query_index',
      handler: input.handler,
      error: input.error,
      entityType: input.entityType,
      recordId: input.recordId ?? null,
      tenantId: input.tenantId,
      organizationId: input.organizationId,
      payload: { enricherId: input.enricher.id, ...input.details },
    },
  ).catch(() => undefined)
}

const COLLISION_SAMPLE_SIZE = 10

function nullOut(targets: readonly IndexDocEnrichmentTarget[], keys: readonly string[], baseKeys: Map<string, Set<string>>): void {
  for (const target of targets) {
    const ownKeys = baseKeys.get(target.recordId)
    for (const key of keys) {
      if (ownKeys?.has(key)) continue
      target.doc[key] = null
    }
  }
}

/**
 * Runs every enricher registered for `entityType` over a batch of freshly built documents and
 * merges the contributed keys into them in place. One `enrich` call per enricher per
 * tenant/organization scope present in the batch — never per record.
 */
export async function applyIndexDocEnrichers(
  db: Kysely<any>,
  entityType: string,
  targets: readonly IndexDocEnrichmentTarget[],
): Promise<void> {
  const enrichers = getRegistryState().byEntityType.get(entityType)
  if (!enrichers?.length || !targets.length) return

  const baseKeys = new Map<string, Set<string>>()
  for (const target of targets) baseKeys.set(target.recordId, new Set(Object.keys(target.doc)))

  const groups = new Map<string, IndexDocEnrichmentTarget[]>()
  for (const target of targets) {
    const key = scopeGroupKey(target)
    const bucket = groups.get(key)
    if (bucket) bucket.push(target)
    else groups.set(key, [target])
  }

  for (const enricher of [...enrichers]) {
    for (const group of groups.values()) {
      const { tenantId, organizationId } = group[0]
      let result: Map<string, IndexDocEnrichment>
      try {
        const records = group.map((target) => ({ recordId: target.recordId, doc: target.doc }))
        const returned = await enricher.enrich(records, { db, entityType, tenantId, organizationId })
        if (!(returned instanceof Map)) {
          throw new Error(`[internal] Index doc enricher "${enricher.id}" must return a Map keyed by record id`)
        }
        result = returned
      } catch (error) {
        nullOut(group, enricher.keys, baseKeys)
        await reportEnricherFailure(db, {
          enricher, entityType, tenantId, organizationId, error,
          handler: 'query_index:doc-enricher',
        })
        continue
      }

      const collidingRecordIdsByKey = new Map<string, string[]>()
      for (const target of group) {
        const contribution = result.get(target.recordId)
        const ownKeys = baseKeys.get(target.recordId)
        for (const key of enricher.keys) {
          if (ownKeys?.has(key)) {
            const colliding = collidingRecordIdsByKey.get(key)
            if (colliding) colliding.push(target.recordId)
            else collidingRecordIdsByKey.set(key, [target.recordId])
            continue
          }
          const value = contribution && Object.prototype.hasOwnProperty.call(contribution, key)
            ? contribution[key]
            : null
          target.doc[key] = value === undefined ? null : value
        }
        if (contribution) {
          const undeclared = Object.keys(contribution).filter((key) => !enricher.keys.includes(key))
          if (undeclared.length) {
            logger.warn('Index doc enricher returned undeclared keys; ignored', {
              enricherId: enricher.id,
              entityType,
              recordId: target.recordId,
              keys: undeclared,
            })
          }
        }
      }
      for (const [key, recordIds] of collidingRecordIdsByKey) {
        await reportEnricherFailure(db, {
          enricher, entityType, tenantId, organizationId,
          recordId: recordIds.length === 1 ? recordIds[0] : undefined,
          error: new Error(`[internal] Index doc enricher "${enricher.id}" key "${key}" collides with a base document key of ${entityType} on ${recordIds.length} record(s)`),
          handler: 'query_index:doc-enricher:collision',
          details: {
            collidingKey: key,
            collidingRecordCount: recordIds.length,
            sampleRecordIds: recordIds.slice(0, COLLISION_SAMPLE_SIZE),
          },
        })
      }
    }
  }
}
