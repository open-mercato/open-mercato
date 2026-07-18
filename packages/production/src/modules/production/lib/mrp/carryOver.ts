import type { MrpSuggestion as EngineSuggestion, MrpSuggestionType, MrpPeggingRef } from './types.js'

/**
 * Task 5.2 — carry-over matching for MRP suggestions (spec § MRP engine,
 * point 3: "previously acknowledged/dismissed suggestions carry over
 * (matched by product + demand source) instead of re-emitting noise").
 *
 * Matching decision (documented, not in the spec's literal wording — this is
 * the concrete rule the worker/persistence layer implements):
 *
 * A "prior resolved" suggestion is any row with `status IN ('accepted',
 * 'dismissed')` from ANY earlier run in the same tenant/org scope. A newly
 * computed suggestion from `runMrp` MATCHES a prior resolved row when they
 * share the same `(suggestionType, productId, variantId, demandSourceKey)`
 * tuple — the "product + demand source" pairing from the spec.
 *
 * `demandSourceKey` (review finding, hardening): built from ALL pegging
 * refs, not just the first one — each ref reduces to `${type}:${id ?? ''}`,
 * the resulting list is SORTED, then joined with `,`. This makes the key
 * invariant to pegging order, which in turn is only as stable as the
 * upstream demand load order (`loaders.ts` now applies a deterministic
 * `ORDER BY id` on every demand-producing query specifically so pegging
 * order does not flip between runs over unchanged data — belt and braces:
 * even if some future demand source forgets an `ORDER BY`, sorting here
 * still keeps the match key itself order-independent).
 *
 * When a match is found, the new suggestion is inserted with
 * `status: 'superseded'` and `carriedFromSuggestionId` pointing at the prior
 * resolved row — NOT re-emitted as `'open'`. This is what makes "a second
 * run does not duplicate accepted/dismissed suggestions" true against the
 * suggestions list's default `status=open` filter, while still keeping a
 * full audit trail of what the engine computed on this run (every
 * suggestion the engine produced gets a row; only its `status` differs).
 *
 * Separately (handled by the caller, `persistSuggestions.ts`, not here):
 * every suggestion still `open` from a PRIOR run is marked `'superseded'`
 * before the new run's suggestions are inserted, since the new run's output
 * fully replaces the previous run's open suggestion set.
 */

export interface PriorResolvedSuggestion {
  id: string
  suggestionType: MrpSuggestionType
  productId: string
  variantId: string | null
  /** Sorted, order-independent digest of every pegging ref's demand source (see module docstring). */
  demandSourceKey: string
  createdAt: Date
}

/** Builds the order-independent demand-source digest described in the module docstring. */
export function buildDemandSourceKey(pegging: MrpPeggingRef[]): string {
  return pegging
    .map((ref) => `${ref.source.type}:${ref.source.id ?? ''}`)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .join(',')
}

export function buildSuggestionMatchKey(input: {
  suggestionType: MrpSuggestionType
  productId: string
  variantId: string | null
  demandSourceKey: string
}): string {
  return [input.suggestionType, input.productId, input.variantId ?? '', input.demandSourceKey].join('::')
}

export function matchKeyForEngineSuggestion(suggestion: EngineSuggestion): string {
  return buildSuggestionMatchKey({
    suggestionType: suggestion.type,
    productId: suggestion.productId,
    variantId: suggestion.variantId,
    demandSourceKey: buildDemandSourceKey(suggestion.pegging),
  })
}

export function matchKeyForPriorSuggestion(prior: PriorResolvedSuggestion): string {
  return buildSuggestionMatchKey(prior)
}

/**
 * Builds a lookup of the latest prior resolved suggestion per match key
 * (when multiple prior rows share a key across different runs, the most
 * recently created one wins).
 */
export function indexPriorResolvedSuggestions(
  priorResolved: PriorResolvedSuggestion[],
): Map<string, PriorResolvedSuggestion> {
  const byKey = new Map<string, PriorResolvedSuggestion>()
  for (const row of priorResolved) {
    const key = matchKeyForPriorSuggestion(row)
    const existing = byKey.get(key)
    if (!existing || row.createdAt.getTime() > existing.createdAt.getTime()) {
      byKey.set(key, row)
    }
  }
  return byKey
}

export interface CarryOverDecision {
  suggestion: EngineSuggestion
  status: 'open' | 'superseded'
  carriedFromSuggestionId: string | null
}

export function computeCarryOverDecisions(
  newSuggestions: EngineSuggestion[],
  priorResolved: PriorResolvedSuggestion[],
): CarryOverDecision[] {
  const byKey = indexPriorResolvedSuggestions(priorResolved)
  return newSuggestions.map((suggestion) => {
    const matched = byKey.get(matchKeyForEngineSuggestion(suggestion))
    if (matched) {
      return { suggestion, status: 'superseded', carriedFromSuggestionId: matched.id }
    }
    return { suggestion, status: 'open', carriedFromSuggestionId: null }
  })
}
