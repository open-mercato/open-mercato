/**
 * One AND-scope. A single source's own grant (a group's, or a channel's) never carries
 * `allOf`; `intersectScopes` adds it when a branch must AND two sources' conditions that
 * cannot be merged into one flat scope without changing which products match.
 */
export type AssortmentScope = {
  categoryIds?: string[]
  tagIds?: string[]
  excludeProductIds?: string[]
  excludeCategoryIds?: string[]
  excludeTagIds?: string[]
  /**
   * Conjunction: a product matches this scope only if it also matches EVERY listed scope
   * (each evaluated with `matchesOne`, so nesting is allowed). Absent or empty = no extra
   * condition. Because every entry is itself a set of inclusion/exclusion id lists, a branch
   * carrying `allOf` is still expressible on the SQL side as an AND of `scopeKeys`
   * array-overlap tests (spec §3.3 / §3.5).
   */
  allOf?: AssortmentScope[]
}

/**
 * The resolved, buyer-facing grant. `null` = unrestricted (every source was unrestricted,
 * or there was nothing to restrict against). A non-null value is an OR-list of AND-scopes
 * (DNF): the buyer is visible-eligible for a product if it matches ANY element. An empty
 * array `[]` is the vacuous OR — it has no element that could ever match, so it means
 * "matches nothing," distinct from `null`.
 */
export type EffectiveAssortmentScope = AssortmentScope[] | null

export type ScopedProduct = { id: string; categoryIds: string[]; tagIds: string[] }
