import type { EntityManager } from '@mikro-orm/postgresql'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { BasicQueryEngine } from '@open-mercato/shared/lib/query/engine'
import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import {
  getSearchModuleConfigs,
  type SearchBuildContext,
  type SearchEntityConfig,
} from '@open-mercato/shared/modules/search'

const logger = createLogger('query_index').child({ component: 'search-entity-policy' })

/**
 * The canonical customer record. Every customer also has a person or company profile indexed under
 * its own entity type, and it is the profile — not the base row — that carries the detail-page
 * navigation.
 */
export const CUSTOMERS_BASE_ENTITY_TYPE = 'customers:customer_entity'

/**
 * Whether base customer rows are offered as search results.
 *
 * Why the knob exists: `search_tokens` is written by the query index for **every** entity a CRUD
 * route indexes, independently of any module's `search.ts` config. `customers:customer_entity` is
 * indexed but no module registers it for search, so its rows only ever surface a second,
 * navigation-less copy of a customer who is already represented by their person or company
 * profile — the duplicate reported in #5046. Worse, the duplicate was visible to superadmins only:
 * `resolveReadableEntityTypes` narrows every other caller to entity types a module registered for
 * search, so the same query returned different shapes for different users.
 *
 * Default `false`: the token strategy never returns base customer rows, so a customer appears
 * exactly once, as their profile. `OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY=true` restores the
 * previous behavior, where both rows are returned and the presenter enricher's linked-result merge
 * collapses the pair into the canonical entity result.
 *
 * Deliberately a **read-side** filter. `search_tokens` is not only the token-search index: the
 * People and Companies list routes resolve their search box through
 * `findEntityIdsBySearchTokens` on this exact entity type, and both query engines rewrite
 * `like`/`ilike` on encrypted customer columns into the same table. Dropping the rows would
 * silently break list search on `display_name`, `primary_email`, `description` and friends, so the
 * rows stay and only the search strategy stops offering them.
 */
export function indexesCustomerBaseEntity(): boolean {
  return parseBooleanWithDefault(process.env.OM_SEARCH_CUSTOMERS_INDEX_BASE_ENTITY, false)
}

/**
 * Entity types the token search strategy must not return.
 *
 * Exposed as a list so the strategy can express the exclusion as a single `NOT IN` predicate
 * instead of post-filtering rows it already paid to fetch — a post-filter would silently shrink
 * the caller's `limit`.
 */
export function listSearchTokenExcludedEntityTypes(): string[] {
  return indexesCustomerBaseEntity() ? [] : [CUSTOMERS_BASE_ENTITY_TYPE]
}

export type SearchTokenIndexGate = NonNullable<SearchEntityConfig['shouldIndex']>

/**
 * The `shouldIndex` hooks a `search.ts` config declares for this entity type.
 *
 * A declared hook gates which records may be searched at all, so the query index evaluates it per
 * record before writing that record's `search_tokens`: the same gate the search indexer's token
 * strategy applies, which keeps the two token writers in agreement. Any declaration counts, enabled
 * or not, so a disabled config still fails closed. An empty list means the entity is ungated.
 */
export function resolveSearchTokenIndexGates(entityType: string): SearchTokenIndexGate[] {
  const gates: SearchTokenIndexGate[] = []
  for (const moduleConfig of getSearchModuleConfigs()) {
    for (const entity of moduleConfig.entities) {
      if (entity.entityId === entityType && typeof entity.shouldIndex === 'function') gates.push(entity.shouldIndex)
    }
  }
  return gates
}

/**
 * Query engine handed to `shouldIndex` hooks evaluated by the query index. It reads base tables
 * directly, so a hook's related-record lookups can never schedule another reindex.
 */
export function createSearchTokenGateQueryEngine(em: EntityManager): QueryEngine {
  return new BasicQueryEngine(em, undefined, () => resolveTenantEncryptionService(em))
}

/**
 * Whether every gate accepts the record. The context mirrors the one the search indexer builds
 * (`record`, `customFields` from the `cf:` keys, scope, `queryEngine`). A gate that returns
 * anything but `true`, or throws, rejects the record (fail closed).
 */
export async function passesSearchTokenIndexGates(
  entityType: string,
  gates: SearchTokenIndexGate[],
  input: {
    recordId: string
    record: Record<string, unknown>
    tenantId: string | null
    organizationId: string | null
    queryEngine?: QueryEngine
  },
): Promise<boolean> {
  const customFields: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input.record)) {
    if (key.startsWith('cf:') || key.startsWith('cf_')) customFields[key.slice(3)] = value
  }
  const context: SearchBuildContext = {
    record: input.record,
    customFields,
    organizationId: input.organizationId,
    tenantId: input.tenantId,
    queryEngine: input.queryEngine,
  }
  for (const gate of gates) {
    try {
      if ((await gate(context)) !== true) return false
    } catch (error) {
      logger.warn('shouldIndex failed, excluding record from search tokens', {
        entityType,
        recordId: input.recordId,
        error: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }
  return true
}
