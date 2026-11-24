import {
  deserializeAdvancedFilter,
  deserializeTree,
  flatToTree,
  convertAdvancedFilterToWhere,
} from '../query/advanced-filter'
import { compileTreeToWhere, type AdvancedFilterTree } from '../query/advanced-filter-tree'
import { createLogger } from '../logger'

const logger = createLogger('shared').child({ component: 'crud' })

/**
 * Parse advanced filter query params and merge with existing Where filters.
 * Call this in buildFilters callback to support advanced filter query params.
 */
export function mergeAdvancedFilters(
  existingFilters: Record<string, unknown>,
  query: Record<string, unknown>,
): Record<string, unknown> {
  const advancedState = deserializeAdvancedFilter(query)
  if (!advancedState) return existingFilters

  const advancedWhere = convertAdvancedFilterToWhere(advancedState)
  if (!Object.keys(advancedWhere).length) return existingFilters

  if (!Object.keys(existingFilters).length) return advancedWhere
  return { $and: [existingFilters, advancedWhere] }
}

/**
 * Combine route-side filters with an advanced filter tree by AND.
 *
 * The compiled tree may itself contain nested `$and`/`$or` — the query engine's
 * normalize step (`compileToDnf` in join-utils.ts) expands those into Disjunctive
 * Normal Form, so the engine sees a single OR group with disjuncts that AND'd
 * leaves. Common-clause lifting in normalize keeps shared predicates ungrouped
 * (preserving the search-tokens optimization).
 */
export function mergeAdvancedFilterTree(
  routeFilters: Record<string, unknown>,
  tree: AdvancedFilterTree | null,
): Record<string, unknown> {
  if (!tree) return routeFilters
  const treeWhere = compileTreeToWhere(tree)
  if (!treeWhere) return routeFilters
  if (Object.keys(routeFilters).length === 0) return treeWhere
  // AND-combine via $and so any nested $and/$or in either side reaches normalize unchanged.
  return { $and: [routeFilters, treeWhere] }
}

/**
 * Read-old-write-new helper: parse the request `query` for either a v2 tree URL
 * or a legacy v1 flat URL (auto-upgraded via flatToTree under SQL precedence),
 * and AND-combine the result with the route's existing filters.
 */
export function mergeAdvancedFiltersFromQuery(
  routeFilters: Record<string, unknown>,
  query: Record<string, unknown>,
): Record<string, unknown> {
  const v2 = deserializeTree(query)
  if (v2) return mergeAdvancedFilterTree(routeFilters, v2)
  const flat = deserializeAdvancedFilter(query)
  if (!flat) return routeFilters
  return mergeAdvancedFilterTree(routeFilters, flatToTree(flat))
}

/**
 * Returns the request's advanced filter as a tree, after stripping the
 * `filter[...]` keys from the query map. Mirrors `mergeAdvancedFiltersFromQuery`
 * but exposes the tree so callers can apply additional shaping (e.g. mapping to
 * `query.ids`, narrowing by feature flags, or surfacing the tree to enrichers)
 * before merging into the route filter.
 *
 * - Detects v2 tree URL params first.
 * - Falls back to legacy v1 flat params, upgraded via `flatToTree` under
 *   standard SQL precedence (AND binds tighter than OR).
 * - Mutates `query` in place: every `filter[...]` key is removed after parsing.
 *
 * Returns `null` when no advanced-filter query params are present.
 */
export function consumeAdvancedFilterState(query: Record<string, unknown>): AdvancedFilterTree | null {
  let tree: AdvancedFilterTree | null = deserializeTree(query)
  if (!tree) {
    const flat = deserializeAdvancedFilter(query)
    if (flat) {
      tree = flatToTree(flat)
      if (process.env.NODE_ENV !== 'production') {
        const sentinel = '__OM_FILTER_V1_WARNED'
        const g = globalThis as Record<string, unknown>
        if (!g[sentinel]) {
          g[sentinel] = true
          // eslint-disable-next-line no-console
          logger.warn('Legacy v1 advanced-filter URL detected; auto-upgraded to v2 tree')
        }
      }
    }
  }

  for (const key of Object.keys(query)) {
    if (key.startsWith('filter[')) {
      delete query[key]
    }
  }

  return tree
}
