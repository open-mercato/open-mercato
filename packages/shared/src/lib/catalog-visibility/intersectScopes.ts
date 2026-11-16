import type { AssortmentScope, EffectiveAssortmentScope } from './types'

type FieldCombination = { ids: string[] | undefined; residual: string[] | undefined }

/**
 * Combines one dimension (categoryIds or tagIds) from two independent AND-scopes. Every
 * outcome is exact — `overlap(P, ids) && overlap(P, residual)` equals
 * `overlap(P, channelIds) && overlap(P, groupIds)` for every product:
 *
 * - Both absent/empty -> unrestricted (`undefined`).
 * - Only one side restricts -> that side's set, unmodified (the other side is vacuously true).
 * - Both restrict and one set is a subset of the other (including equal sets) -> the subset,
 *   because overlapping the subset already implies overlapping the superset.
 * - Both restrict with incomparable sets -> the channel's set stays on the branch and the
 *   group's set is returned as `residual`, to be ANDed via `allOf`. Set-intersecting the two
 *   would wrongly deny a product that satisfies each side through a different id (e.g. a
 *   product in both Electronics and Clearance under channel [Electronics] ∩ group [Clearance]).
 */
function combineField(channelIds: string[] | undefined, groupIds: string[] | undefined): FieldCombination {
  const a = channelIds && channelIds.length > 0 ? channelIds : undefined
  const b = groupIds && groupIds.length > 0 ? groupIds : undefined
  if (!a && !b) return { ids: undefined, residual: undefined }
  if (!a) return { ids: b, residual: undefined }
  if (!b) return { ids: a, residual: undefined }
  const bSet = new Set(b)
  if (a.every((id) => bSet.has(id))) return { ids: a, residual: undefined }
  const aSet = new Set(a)
  if (b.every((id) => aSet.has(id))) return { ids: b, residual: undefined }
  return { ids: a, residual: b }
}

/**
 * Excludes are always safe to union: `NOT excluded_a AND NOT excluded_b` is exactly
 * `NOT (excluded_a OR excluded_b)`, i.e. avoiding the union of both exclude sets.
 */
function unionIds(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])]
  if (merged.length === 0) return undefined
  return Array.from(new Set(merged))
}

/**
 * Builds one branch equivalent to "matches `channel` AND matches `group`". Dimensions and
 * excludes are merged into flat fields where that is exact; whatever cannot be merged
 * exactly (incomparable inclusion sets, and any `allOf` either side already carries) is
 * kept as `allOf` entries, which `matchesOne` ANDs at match time. Never returns an
 * unsatisfiable-looking or dropped branch.
 */
function mergeAsConjunction(channel: AssortmentScope, group: AssortmentScope): AssortmentScope {
  const categoryCombination = combineField(channel.categoryIds, group.categoryIds)
  const tagCombination = combineField(channel.tagIds, group.tagIds)

  const merged: AssortmentScope = {}
  if (categoryCombination.ids) merged.categoryIds = categoryCombination.ids
  if (tagCombination.ids) merged.tagIds = tagCombination.ids

  const excludeProductIds = unionIds(channel.excludeProductIds, group.excludeProductIds)
  if (excludeProductIds) merged.excludeProductIds = excludeProductIds
  const excludeCategoryIds = unionIds(channel.excludeCategoryIds, group.excludeCategoryIds)
  if (excludeCategoryIds) merged.excludeCategoryIds = excludeCategoryIds
  const excludeTagIds = unionIds(channel.excludeTagIds, group.excludeTagIds)
  if (excludeTagIds) merged.excludeTagIds = excludeTagIds

  const residual: AssortmentScope = {}
  if (categoryCombination.residual) residual.categoryIds = categoryCombination.residual
  if (tagCombination.residual) residual.tagIds = tagCombination.residual

  const allOf: AssortmentScope[] = [
    ...(Object.keys(residual).length > 0 ? [residual] : []),
    ...(channel.allOf ?? []),
    ...(group.allOf ?? []),
  ]
  if (allOf.length > 0) merged.allOf = allOf

  return merged
}

/**
 * Distributes a single channel-level scope across every branch of an already-unioned
 * group-level effective scope: (channel) ∩ (g1 ∪ g2 ∪ ... ∪ gn) = (channel∩g1) ∪ (channel∩g2) ∪ ...
 * Each branch is exact by construction (spec §3.3 / §11):
 * `matchesScope(p, intersectScopes(channel, group)) === (channel === null || matchesOne(p, channel)) && matchesScope(p, group)`
 * for every product. See `mergeAsConjunction` for how a branch carries both conditions.
 *
 * Branches are never dropped, so the result is `[]` (deny-all) only when `group` is `[]`.
 * Merging raw category/tag arrays by plain union or intersection is wrong for the same
 * structural reason flattening the union was wrong (R2) — do not reintroduce it.
 */
export function intersectScopes(channel: AssortmentScope | null, group: EffectiveAssortmentScope): EffectiveAssortmentScope {
  if (channel === null) return group
  if (group === null) return [channel]
  return group.map((branch) => mergeAsConjunction(channel, branch))
}
