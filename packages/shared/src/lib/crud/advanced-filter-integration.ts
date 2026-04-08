import { deserializeAdvancedFilter, convertAdvancedFilterToWhere } from '../query/advanced-filter'

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
