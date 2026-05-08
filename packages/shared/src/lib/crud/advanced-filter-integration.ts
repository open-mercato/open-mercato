import {
  deserializeAdvancedFilter,
  deserializeTree,
  flatToTree,
  convertAdvancedFilterToWhere,
} from '../query/advanced-filter'
import { compileTreeToWhere, type AdvancedFilterTree } from '../query/advanced-filter-tree'

function splitOrClauses(filters: Record<string, unknown>): {
  directFilters: Record<string, unknown>
  orClauses: Record<string, unknown>[] | null
} {
  const directFilters: Record<string, unknown> = {}
  let orClauses: Record<string, unknown>[] | null = null

  for (const [key, value] of Object.entries(filters)) {
    if (key === '$or' && Array.isArray(value)) {
      orClauses = value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
      continue
    }
    directFilters[key] = value
  }

  return { directFilters, orClauses }
}

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

  if ('$or' in advancedWhere) {
    if (!Object.keys(existingFilters).length) return advancedWhere

    const { directFilters: existingDirect, orClauses: existingOrClauses } = splitOrClauses(existingFilters)
    const advancedClauses = Array.isArray((advancedWhere as { $or?: unknown }).$or)
      ? ((advancedWhere as { $or: unknown[] }).$or).filter(
          (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry),
        )
      : []

    if (!advancedClauses.length) return existingFilters

    if (!existingOrClauses?.length) {
      return {
        ...existingDirect,
        $or: advancedClauses,
      }
    }

    const combinedClauses: Record<string, unknown>[] = []
    for (const leftClause of existingOrClauses) {
      for (const rightClause of advancedClauses) {
        combinedClauses.push({
          ...leftClause,
          ...rightClause,
        })
      }
    }

    return combinedClauses.length
      ? {
          ...existingDirect,
          $or: combinedClauses,
        }
      : existingFilters
  }

  // AND logic: merge directly
  return { ...existingFilters, ...advancedWhere }
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
