/** One source's own grant — a group's, or a channel's. Never combines more than one source. */
export type AssortmentScope = {
  categoryIds?: string[]
  tagIds?: string[]
  excludeProductIds?: string[]
  excludeCategoryIds?: string[]
  excludeTagIds?: string[]
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
