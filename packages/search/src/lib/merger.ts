import type { SearchResult, ResultMergeConfig, SearchStrategyId } from '../types'

/**
 * Default RRF constant (k=60 is standard in literature).
 * Higher values reduce the influence of ranking position.
 */
const RRF_K = 60

/**
 * Reciprocal Rank Fusion (RRF) algorithm for combining results from multiple search strategies.
 *
 * RRF is a simple but effective method for combining ranked lists. For each result,
 * it computes: score = sum(weight / (k + rank)) across all lists containing that result.
 *
 * Reference: Cormack, G.V., Clarke, C.L.A., & Buettcher, S. (2009).
 * "Reciprocal rank fusion outperforms condorcet and individual rank learning methods"
 * https://plg.uwaterloo.ca/~gvcormac/cormacksigir09-rrf.pdf
 *
 * @param results - Array of search results from multiple strategies
 * @param config - Merge configuration with weights and thresholds
 * @returns Merged and ranked results
 */
export function mergeAndRankResults(
  results: SearchResult[],
  config: ResultMergeConfig,
): SearchResult[] {
  if (results.length === 0) return []

  // Group results by source strategy for rank calculation
  const bySource = new Map<SearchStrategyId, SearchResult[]>()
  for (const result of results) {
    const list = bySource.get(result.source) ?? []
    list.push(result)
    bySource.set(result.source, list)
  }

  // Track seen results with their RRF scores
  const seen = new Map<string, { result: SearchResult; rrf: number; sources: Set<SearchStrategyId> }>()

  // Calculate RRF score for each result
  for (const [source, sourceResults] of bySource) {
    const weight = config.strategyWeights?.[source] ?? 1.0

    for (let rank = 0; rank < sourceResults.length; rank++) {
      const result = sourceResults[rank]
      const key = `${result.entityId}:${result.recordId}`
      const rrfScore = weight / (RRF_K + rank + 1)

      const existing = seen.get(key)
      if (existing) {
        // Combine RRF scores for duplicates found in multiple strategies
        existing.rrf += rrfScore
        existing.sources.add(source)

        // Keep the result with better presenter/metadata based on strategy priority
        if (result.score > existing.result.score) {
          existing.result = { ...result }
        }
      } else {
        seen.set(key, {
          result: { ...result },
          rrf: rrfScore,
          sources: new Set([source]),
        })
      }
    }
  }

  // Convert to array with final RRF scores
  let merged = Array.from(seen.values()).map(({ result, rrf, sources }) => ({
    ...result,
    score: rrf,
    metadata: {
      ...result.metadata,
      _sources: Array.from(sources),
      _rrfScore: rrf,
    },
  }))

  // Apply minimum score threshold
  if (config.minScore != null) {
    merged = merged.filter((r) => r.score >= config.minScore!)
  }

  // Sort by RRF score descending
  merged.sort((a, b) => b.score - a.score)

  return merged
}

/**
 * Simple deduplication without RRF scoring.
 * Keeps the highest-scored result for each entity+record pair.
 *
 * @param results - Array of search results
 * @returns Deduplicated results sorted by score
 */
export function deduplicateResults(results: SearchResult[]): SearchResult[] {
  const seen = new Map<string, SearchResult>()

  for (const result of results) {
    const key = `${result.entityId}:${result.recordId}`
    const existing = seen.get(key)

    if (!existing || result.score > existing.score) {
      seen.set(key, result)
    }
  }

  return Array.from(seen.values()).sort((a, b) => b.score - a.score)
}

/**
 * Normalize scores to 0-1 range using min-max normalization.
 * Useful when combining strategies with different score scales.
 *
 * @param results - Array of search results
 * @returns Results with normalized scores
 */
export function normalizeScores(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return []

  const scores = results.map((r) => r.score)
  const minScore = Math.min(...scores)
  const maxScore = Math.max(...scores)
  const range = maxScore - minScore

  if (range === 0) {
    // All scores are the same, normalize to 1.0
    return results.map((r) => ({ ...r, score: 1.0 }))
  }

  return results.map((r) => ({
    ...r,
    score: (r.score - minScore) / range,
  }))
}
