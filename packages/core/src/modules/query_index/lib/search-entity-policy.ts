import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'

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
