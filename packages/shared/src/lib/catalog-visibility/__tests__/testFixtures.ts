import type { AssortmentScope, ScopedProduct } from '../types'

/**
 * Deterministic PRNG (mulberry32) so property-based runs are reproducible across CI runs
 * without pulling in a third-party dependency — no `fast-check`-equivalent library is
 * present anywhere in this monorepo's workspaces (checked via `yarn why fast-check` /
 * grepping every `package.json`), so this hand-rolled generator is the documented fallback
 * per `.ai/specs/2026-04-24-agentic-property-based-testing.md`.
 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const CATEGORY_UNIVERSE = ['c1', 'c2', 'c3', 'c4', 'c5']
export const TAG_UNIVERSE = ['t1', 't2', 't3', 't4', 't5']
export const PRODUCT_ID_UNIVERSE = ['p1', 'p2', 'p3', 'p4', 'p5']

function randomSubset(rng: () => number, universe: string[], inclusionRate = 0.4): string[] {
  return universe.filter(() => rng() < inclusionRate)
}

/** Generates a random `AssortmentScope | null` "source" (as `unionScopes` consumes). */
export function randomSource(rng: () => number): AssortmentScope | null {
  if (rng() < 0.2) return null
  const scope: AssortmentScope = {}
  if (rng() < 0.6) {
    const categoryIds = randomSubset(rng, CATEGORY_UNIVERSE)
    if (categoryIds.length > 0) scope.categoryIds = categoryIds
  }
  if (rng() < 0.6) {
    const tagIds = randomSubset(rng, TAG_UNIVERSE)
    if (tagIds.length > 0) scope.tagIds = tagIds
  }
  if (rng() < 0.2) {
    const excludeProductIds = randomSubset(rng, PRODUCT_ID_UNIVERSE)
    if (excludeProductIds.length > 0) scope.excludeProductIds = excludeProductIds
  }
  if (rng() < 0.2) {
    const excludeCategoryIds = randomSubset(rng, CATEGORY_UNIVERSE)
    if (excludeCategoryIds.length > 0) scope.excludeCategoryIds = excludeCategoryIds
  }
  if (rng() < 0.2) {
    const excludeTagIds = randomSubset(rng, TAG_UNIVERSE)
    if (excludeTagIds.length > 0) scope.excludeTagIds = excludeTagIds
  }
  return scope
}

/** Generates a random `AssortmentScope` (never `null`) for use as a channel scope. */
export function randomAssortmentScope(rng: () => number): AssortmentScope {
  return (randomSource(rng) ?? {}) as AssortmentScope
}

export function randomProduct(rng: () => number, index: number): ScopedProduct {
  return {
    id: PRODUCT_ID_UNIVERSE[index % PRODUCT_ID_UNIVERSE.length],
    categoryIds: randomSubset(rng, CATEGORY_UNIVERSE),
    tagIds: randomSubset(rng, TAG_UNIVERSE),
  }
}

function isSubset(a: string[], b: string[]): boolean {
  const set = new Set(b)
  return a.every((id) => set.has(id))
}

/**
 * Detects the one documented, accepted approximation boundary of `intersectScopes`
 * (see its own doc comment): a dimension where the channel and a group branch both
 * restrict non-emptily with neither set a subset of the other. Only inside this boundary
 * can `intersectScopes` under-match relative to the mathematically pure
 * `matchesOne(channel) && matchesScope(group)` definition (proven empirically — see
 * `intersectScopes.test.ts`'s "no structural conflict implies exact equality" property,
 * which runs this same detector over thousands of fixtures with zero counter-examples
 * outside it).
 */
export function hasIncomparableDimensionConflict(
  channel: AssortmentScope | null,
  groupBranches: AssortmentScope[],
): boolean {
  if (channel === null) return false
  for (const branch of groupBranches) {
    for (const dimension of ['categoryIds', 'tagIds'] as const) {
      const a = channel[dimension] ?? []
      const b = branch[dimension] ?? []
      if (a.length > 0 && b.length > 0 && !isSubset(a, b) && !isSubset(b, a)) return true
    }
  }
  return false
}
