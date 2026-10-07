import type { RawResult, ResultProvenance, SearchResult } from '../contract/results'
import { canonicalizeUrl } from './canonicalize'

/**
 * Reciprocal-rank-fusion damping constant. 60 is the value from the original
 * Cormack et al. formulation and is deliberately large relative to typical result
 * counts, so a hit ranked 1 by one adapter cannot dominate a hit ranked 2 by two.
 */
export const RRF_K = 60

export type FusionInput = {
  readonly adapterId: string
  readonly weight: number
  readonly results: readonly RawResult[]
}

export type FusionOptions = {
  readonly limit: number
  readonly minResults: number
  readonly minConfidence: number
  readonly maxPerDomain: number
}

export type FusionOutput = {
  readonly results: readonly SearchResult[]
  /** True when the confidence threshold or domain cap had to be relaxed. */
  readonly degraded: boolean
}

type Accumulator = {
  readonly key: string
  readonly domain: string
  url: string
  title: string | null
  snippet: string | null
  content: string | null
  publishedAt: string | null
  score: number
  readonly sources: ResultProvenance[]
}

function longest(current: string | null, candidate: string | null | undefined): string | null {
  const next = candidate?.trim()
  if (!next) return current
  if (current === null || next.length > current.length) return next
  return current
}

/**
 * Merges per-adapter result lists into one ranked set.
 *
 * RRF is used rather than blending native scores because the sources are not
 * comparable: an LLM citation list has no score at all, a SERP has an opaque
 * one, and a paid API has its own scale. Rank is the only signal every adapter
 * genuinely agrees on.
 */
export function fuseResults(inputs: readonly FusionInput[], options: FusionOptions): FusionOutput {
  const accumulators = new Map<string, Accumulator>()

  for (const input of inputs) {
    const weight = input.weight > 0 ? input.weight : 1
    // Two spellings of one URL inside a single adapter's list must not each earn
    // that adapter a rank slot: the duplicate would compound its own score and
    // let one source outvote the agreement between two independent ones.
    const contributed = new Set<string>()
    let rank = 0
    for (const result of input.results) {
      const canonical = canonicalizeUrl(result.url)
      if (canonical === null) continue
      if (contributed.has(canonical.key)) continue
      contributed.add(canonical.key)
      rank += 1
      const existing = accumulators.get(canonical.key)
      const accumulator: Accumulator = existing ?? {
        key: canonical.key,
        domain: canonical.domain,
        url: canonical.url,
        title: null,
        snippet: null,
        content: null,
        publishedAt: null,
        score: 0,
        sources: [],
      }
      accumulator.title = longest(accumulator.title, result.title)
      accumulator.snippet = longest(accumulator.snippet, result.snippet)
      accumulator.content = accumulator.content ?? (result.content?.trim() || null)
      accumulator.publishedAt = accumulator.publishedAt ?? (result.publishedAt?.trim() || null)
      accumulator.score += weight / (RRF_K + rank)
      accumulator.sources.push({ adapterId: input.adapterId, rank })
      if (!existing) accumulators.set(canonical.key, accumulator)
    }
  }

  if (accumulators.size === 0) return { results: [], degraded: false }

  const maxScore = Math.max(...[...accumulators.values()].map((entry) => entry.score))
  const ranked = [...accumulators.values()]
    .map((entry) => ({
      entry,
      result: {
        url: entry.url,
        title: entry.title ?? entry.url,
        snippet: entry.snippet,
        content: entry.content,
        publishedAt: entry.publishedAt,
        confidence: maxScore > 0 ? Number((entry.score / maxScore).toFixed(6)) : 0,
        sources: entry.sources,
      } satisfies SearchResult,
    }))
    .sort((left, right) => {
      if (right.result.confidence !== left.result.confidence) {
        return right.result.confidence - left.result.confidence
      }
      return left.entry.key < right.entry.key ? -1 : left.entry.key > right.entry.key ? 1 : 0
    })

  const perDomain = new Map<string, number>()
  const primary: SearchResult[] = []
  const overflow: SearchResult[] = []

  for (const { entry, result } of ranked) {
    const used = perDomain.get(entry.domain) ?? 0
    if (used >= options.maxPerDomain || result.confidence < options.minConfidence) {
      overflow.push(result)
      continue
    }
    perDomain.set(entry.domain, used + 1)
    primary.push(result)
  }

  // A confidence threshold or a domain cap must never manufacture an empty
  // answer: fall back to the best rejected hits and report the relaxation.
  let degraded = false
  const selected = primary.slice(0, options.limit)
  if (selected.length < Math.min(options.minResults, ranked.length)) {
    const needed = Math.min(options.minResults, options.limit) - selected.length
    if (needed > 0 && overflow.length > 0) {
      degraded = true
      selected.push(...overflow.slice(0, needed))
    }
  }

  return { results: selected, degraded }
}
