import type { AssortmentScope, EffectiveAssortmentScope } from './types'

/**
 * Combines N independent sources' own scopes into one OR-list.
 * THE CRITICAL CORRECTNESS REQUIREMENT (a first draft got this wrong — R2 defect):
 * do NOT merge every source's categoryIds/tagIds into one flat AssortmentScope object.
 * That computes AND across sources' dimensions instead of OR. Each source becomes its
 * own OR-branch in the returned list, UNMODIFIED — nothing about one source's scope
 * changes because another source exists.
 */
export function unionScopes(scopes: Array<AssortmentScope | null>): EffectiveAssortmentScope {
  if (scopes.length === 0) return null
  if (scopes.some((s) => s === null)) return null
  return scopes as AssortmentScope[]
}
