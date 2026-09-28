import type { AssortmentScope, EffectiveAssortmentScope } from './types'

type FieldCombination = { ids: string[] | undefined; impossible: boolean }

/**
 * Combines one dimension (categoryIds or tagIds) from two independent AND-scopes into the
 * value that dimension must carry on the merged branch.
 *
 * - Both absent/empty -> unrestricted (`undefined`).
 * - Only one side restricts -> that side's set, unmodified (the other side is vacuously
 *   true, so the AND reduces to the restricting side alone — exact, no approximation).
 * - Both restrict and one set is a subset of the other (including equal sets) -> the
 *   subset. This is also exact: `overlap(P, subset)` already implies `overlap(P, superset)`
 *   for any product, so the AND collapses to the narrower condition with no information
 *   loss.
 * - Both restrict with genuinely incomparable sets (neither is a subset of the other) ->
 *   the set-intersection of the two, UNLESS that intersection is empty, in which case the
 *   dimension is flagged `impossible`.
 *
 * The incomparable case is a deliberate, documented approximation, not a bug: `categoryIds`
 * only expresses an existential ("product has ANY of these ids") per §3.2, and there is no
 * way to encode "must independently satisfy source A's existential AND source B's existential"
 * as a single existential set when a product could satisfy each via a *different* id. Using
 * the intersection is *sound* (a product that overlaps the intersection always overlaps both
 * original sets) but not *complete* (a product overlapping A via one id and B via a different,
 * non-shared id is a false negative). This is intentional and fails toward under-granting
 * (denying visibility), never over-granting — the safe direction for a catalog-visibility
 * gate. See the R2 regression note on `unionScopes` for the sibling mistake this avoids: do
 * NOT try to "fix" this by merging the raw arrays (union or unqualified intersection) instead
 * of this subset-aware rule — that reintroduces exactly the flattening bug this file exists to
 * prevent, and is empirically excludable (see `intersectScopes.test.ts`'s "no structural
 * conflict" property, which requires this fully exact behavior whenever the incomparable case
 * does not arise).
 */
function combineField(channelIds: string[] | undefined, groupIds: string[] | undefined): FieldCombination {
  const a = channelIds && channelIds.length > 0 ? channelIds : undefined
  const b = groupIds && groupIds.length > 0 ? groupIds : undefined
  if (!a && !b) return { ids: undefined, impossible: false }
  if (!a) return { ids: b, impossible: false }
  if (!b) return { ids: a, impossible: false }
  const bSet = new Set(b)
  const aSubsetOfB = a.every((id) => bSet.has(id))
  if (aSubsetOfB) return { ids: a, impossible: false }
  const aSet = new Set(a)
  const bSubsetOfA = b.every((id) => aSet.has(id))
  if (bSubsetOfA) return { ids: b, impossible: false }
  const intersection = a.filter((id) => bSet.has(id))
  if (intersection.length === 0) return { ids: undefined, impossible: true }
  return { ids: intersection, impossible: false }
}

/**
 * Excludes are always safe to union: `NOT excluded` requires avoiding every id in the
 * combined exclude set, and `NOT excluded_a AND NOT excluded_b` is exactly
 * `NOT (excluded_a OR excluded_b)`, i.e. avoiding the union of both exclude sets. Unlike
 * `combineField`, this is an exact equivalence, not an approximation — exclusion is a
 * universal ("avoid ALL of these ids") condition, so OR-ing two universals over disjoint
 * sets is itself just a bigger universal over the combined set.
 */
function unionIds(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])]
  if (merged.length === 0) return undefined
  return Array.from(new Set(merged))
}

function mergeAsConjunction(channel: AssortmentScope, group: AssortmentScope): AssortmentScope | null {
  const categoryCombination = combineField(channel.categoryIds, group.categoryIds)
  const tagCombination = combineField(channel.tagIds, group.tagIds)
  if (categoryCombination.impossible || tagCombination.impossible) return null

  const merged: AssortmentScope = {}
  if (categoryCombination.ids) merged.categoryIds = categoryCombination.ids
  if (tagCombination.ids) merged.tagIds = tagCombination.ids

  const excludeProductIds = unionIds(channel.excludeProductIds, group.excludeProductIds)
  if (excludeProductIds) merged.excludeProductIds = excludeProductIds
  const excludeCategoryIds = unionIds(channel.excludeCategoryIds, group.excludeCategoryIds)
  if (excludeCategoryIds) merged.excludeCategoryIds = excludeCategoryIds
  const excludeTagIds = unionIds(channel.excludeTagIds, group.excludeTagIds)
  if (excludeTagIds) merged.excludeTagIds = excludeTagIds

  return merged
}

/**
 * Distributes a single channel-level scope across every branch of an already-unioned
 * group-level effective scope: (channel) ∩ (g1 ∪ g2 ∪ ... ∪ gn) = (channel∩g1) ∪ (channel∩g2) ∪ ...
 * Each branch keeps BOTH conditions and evaluates them together — this is why intersection
 * does NOT merge categoryIds/tagIds arrays via plain set intersection unconditionally: a
 * merge that ignores the "one side unrestricted" and "one side a subset of the other" cases
 * computes a different, STRONGER condition than "matches channel's own AND-rule and matches
 * this group's own AND-rule," for the same structural reason flattening the union was wrong.
 * `combineField` above derives the correct per-dimension rule, including the residual,
 * documented approximation for genuinely incomparable non-empty sets.
 *
 * A branch whose merge is structurally unsatisfiable (`combineField` reports `impossible` on
 * either dimension) is dropped from the returned list rather than kept as a scope that could
 * be misread as unrestricted — an empty `categoryIds`/`tagIds` means "no restriction" per
 * §3.2, so a dropped-to-empty intersection must never be represented that way. If every branch
 * is dropped, the result is `[]` (deny-all), which is exactly the type's own vocabulary for
 * "matches nothing."
 */
export function intersectScopes(channel: AssortmentScope | null, group: EffectiveAssortmentScope): EffectiveAssortmentScope {
  if (channel === null) return group
  if (group === null) return [channel]
  return group
    .map((branch) => mergeAsConjunction(channel, branch))
    .filter((scope): scope is AssortmentScope => scope !== null)
}
