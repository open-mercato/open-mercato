import type {
  ContextProvenance,
  ContextRoutedSource,
  ContextPrunedSource,
  ContextSourceKind,
} from '../../data/validators'
import type { ContextSourceHit } from './registry'

/**
 * Budget packer (context overlay, Phases 1 + 4).
 *
 * Mandatory-first, priority-ordered packing: the mandatory floor is ALWAYS routed
 * (a regulated-domain source can never be ranked out), then descending-score
 * optional fill packs the remaining budget. Whole sources are pruned with a reason
 * — NEVER mid-fact truncation. The records handed in are already redacted (P4:
 * encrypted/PII values are removed by the resolver BEFORE estimation), so the
 * token estimate and the packed payload only ever cover least-privilege content.
 *
 * Budget invariant: the OPTIONAL fill is bounded so `tokensUsed ≤ tokenBudget`
 * holds across the optional tier — anything that does not fit is pruned, never
 * truncated. The mandatory floor is the single documented exception: it is routed
 * whole even if it alone exceeds the budget (the floor guarantee takes precedence
 * over the cap — a capability whose declared floor exceeds its budget is a
 * misconfiguration, not an excuse to drop regulated evidence). In practice a
 * capability declares a floor that fits, so `tokensUsed ≤ tokenBudget` holds.
 */

/**
 * Conservative chars-per-token heuristic. Tokens ≈ serialized-JSON length / 4 (the
 * usual ~4-chars-per-token rule of thumb for English/code), rounded UP with a floor
 * of 1. Deliberately an over-estimate so we err toward pruning rather than
 * overflowing a real model context window; exactness is not required — the
 * routed/pruned INVARIANT is. Swap in a model tokenizer behind this signature when
 * per-model budgeting is needed.
 */
const CHARS_PER_TOKEN = 4

/** Estimate the token cost of a fact's redacted record. Conservative (rounds up). */
export function estimateTokens(record: Record<string, unknown>): number {
  const serialized = JSON.stringify(record ?? {})
  return Math.max(1, Math.ceil(serialized.length / CHARS_PER_TOKEN))
}

/** A candidate handed to the packer, carrying its tier + estimated cost + provenance. */
export type PackCandidate = {
  kind: ContextSourceKind
  tier: 'mandatory' | 'optional'
  hit: ContextSourceHit
  tokens: number
  provenance: ContextProvenance
}

export type PackResult = {
  routedSources: ContextRoutedSource[]
  prunedSources: ContextPrunedSource[]
  sources: ContextProvenance[]
  tokensUsed: number
}

const PRUNE_REASON_OVER_BUDGET = 'over_budget'

/**
 * Pack candidates under `tokenBudget`. Mandatory candidates are routed first in
 * priority order and are NEVER pruned for budget (the floor is guaranteed — if the
 * floor alone exceeds the budget, `tokensUsed` may exceed it by design rather than
 * dropping mandatory evidence). Optional candidates fill the remaining budget by
 * descending score; the rest are pruned with `over_budget`.
 */
export function packCandidates(
  candidates: PackCandidate[],
  tokenBudget: number,
): PackResult {
  const routedSources: ContextRoutedSource[] = []
  const prunedSources: ContextPrunedSource[] = []
  const sources: ContextProvenance[] = []
  let tokensUsed = 0

  const mandatory = candidates.filter((candidate) => candidate.tier === 'mandatory')
  const optional = candidates
    .filter((candidate) => candidate.tier === 'optional')
    .sort((left, right) => (right.hit.score ?? 0) - (left.hit.score ?? 0))

  for (const candidate of mandatory) {
    tokensUsed += candidate.tokens
    routedSources.push(toRouted(candidate))
    sources.push(candidate.provenance)
  }

  for (const candidate of optional) {
    if (tokensUsed + candidate.tokens <= tokenBudget) {
      tokensUsed += candidate.tokens
      routedSources.push(toRouted(candidate))
      sources.push(candidate.provenance)
    } else {
      prunedSources.push({
        kind: candidate.kind,
        ref: candidate.hit.ref,
        reason: PRUNE_REASON_OVER_BUDGET,
      })
    }
  }

  return { routedSources, prunedSources, sources, tokensUsed }
}

function toRouted(candidate: PackCandidate): ContextRoutedSource {
  return {
    kind: candidate.kind,
    ref: candidate.hit.ref,
    tokens: candidate.tokens,
    ...(candidate.hit.locator ? { locator: candidate.hit.locator } : {}),
    ...(candidate.hit.score !== undefined ? { score: candidate.hit.score } : {}),
  }
}
