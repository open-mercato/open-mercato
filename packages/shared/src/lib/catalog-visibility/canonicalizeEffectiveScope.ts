import type { AssortmentScope, EffectiveAssortmentScope } from './types'

const ID_LIST_KEYS = [
  'categoryIds',
  'excludeCategoryIds',
  'excludeProductIds',
  'excludeTagIds',
  'tagIds',
] as const

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values)).sort(compareStrings)
}

function canonicalizeBranch(scope: AssortmentScope): string {
  const members: string[] = []
  const nested = (scope.allOf ?? []).map(canonicalizeBranch)
  if (nested.length > 0) members.push(`"allOf":[${sortedUnique(nested).join(',')}]`)
  for (const key of ID_LIST_KEYS) {
    const ids = scope[key] ?? []
    if (ids.length > 0) members.push(`${JSON.stringify(key)}:${JSON.stringify(sortedUnique(ids))}`)
  }
  return `{${members.join(',')}}`
}

/**
 * Deterministic serialization of a resolved scope. `null` (unrestricted) serializes as `null`
 * and `[]` (deny-all) as `[]`, so the two never collide. Empty and absent arrays are
 * equivalent, id lists are sorted and deduplicated, and OR-branches and `allOf` entries are
 * ordered by their own canonical form with identical ones collapsed.
 */
export function canonicalizeEffectiveScope(scope: EffectiveAssortmentScope): string {
  if (scope === null) return 'null'
  return `[${sortedUnique(scope.map(canonicalizeBranch)).join(',')}]`
}
