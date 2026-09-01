/**
 * Data migrations rewrite columns in raw SQL, so they bypass every CRUD/indexer helper that
 * would normally emit `query_index.upsert_one`. A migration also cannot emit from where it
 * stands: it runs inside its own transaction with no DI container, and the projection must
 * only be refreshed once the rewrite has committed.
 *
 * A migration therefore *declares* the entity types whose projections it invalidated, and
 * `mercato db migrate` discharges the obligation after the whole run commits.
 */

export const QUERY_INDEX_REINDEX_EXPORT = 'queryIndexReindexEntityTypes'

const ENTITY_TYPE_PATTERN = /^[a-z0-9_]+:[a-z0-9_]+$/

export function isQueryIndexEntityType(value: unknown): value is string {
  return typeof value === 'string' && ENTITY_TYPE_PATTERN.test(value)
}

export function declareQueryIndexReindex(entityTypes: readonly string[]): readonly string[] {
  if (!Array.isArray(entityTypes) || entityTypes.length === 0) {
    throw new Error('[internal] declareQueryIndexReindex requires at least one entity type')
  }
  const normalized: string[] = []
  for (const entityType of entityTypes) {
    if (!isQueryIndexEntityType(entityType)) {
      throw new Error(
        `[internal] declareQueryIndexReindex expects "module:entity" identifiers, received: ${String(entityType)}`,
      )
    }
    if (!normalized.includes(entityType)) normalized.push(entityType)
  }
  return Object.freeze(normalized)
}

export function readQueryIndexReindexDeclaration(moduleExports: unknown): string[] {
  if (!moduleExports || typeof moduleExports !== 'object') return []
  const declared = (moduleExports as Record<string, unknown>)[QUERY_INDEX_REINDEX_EXPORT]
  if (!Array.isArray(declared)) return []
  const collected: string[] = []
  for (const entityType of declared) {
    if (!isQueryIndexEntityType(entityType)) continue
    if (!collected.includes(entityType)) collected.push(entityType)
  }
  return collected
}

export function formatQueryIndexRebuildCommands(entityTypes: readonly string[]): string[] {
  return entityTypes.map((entityType) => `mercato query_index rebuild --entity ${entityType} --global`)
}
