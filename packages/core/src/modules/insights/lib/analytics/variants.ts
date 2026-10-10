import { computeVariantHash } from '../process/caseSummary'
import { buildEnvelope, type BuildContext } from './envelope'
import { createSuppressionTally, rate, summarizeDurations, suppressCells } from './stats'
import { completedInWindow, cycleTimeOf, variantKeysOf, type PreparedCase } from './trace'
import { XRAY_ANALYTICS_LIMITS, type VariantsResult } from './types'

type VariantCell = {
  variantHash: string
  activityKeys: string[]
  storedHashes: Set<string>
  rawHashes: Set<string>
  cases: Set<string>
  actors: Set<string>
  cycles: number[]
}

/**
 * Variants of the cases that completed in the window (complete traces only: a trace cut by
 * the per-case read limit is counted in `truncatedCases`, never guessed). A variant is the
 * collapsed sequence of lifecycle, stage and milestone steps, hashed like the projection's
 * `variant_hash`; `distinctVariants.raw` counts the variants before collapse. Each item lists
 * the stored `variant_hash` values of its cases (the case summaries' own hashes, so a
 * drill-down through `listCases({ variantHashes })` matches them), at most 20, with
 * `rawVariantHashesTruncated` when more were cut. Cycle times exclude `sync_run` starts/ends
 * unless requested. Variants are suppressed under the k / distinct-actor thresholds with
 * complementary suppression; once one is suppressed, `distinctVariants` counts the visible
 * variants only. `limit` keeps the most frequent variants; the rest are counted in `omitted`.
 */
export function buildVariants(cases: readonly PreparedCase[], context: BuildContext, limit: number): VariantsResult {
  const population = cases.filter((prepared) => completedInWindow(prepared, context.window))
  const complete = population.filter((prepared) => prepared.trace.complete)
  const groups = new Map<string, VariantCell>()
  const rawHashes = new Set<string>()
  for (const prepared of complete) {
    const keys = variantKeysOf(prepared.filteredCollapsed)
    const variantHash = computeVariantHash(keys)
    const rawHash = computeVariantHash(variantKeysOf(prepared.filteredRaw))
    rawHashes.add(rawHash)
    const cell = groups.get(variantHash) ?? {
      variantHash,
      activityKeys: keys,
      storedHashes: new Set<string>(),
      rawHashes: new Set<string>(),
      cases: new Set<string>(),
      actors: new Set<string>(),
      cycles: [],
    }
    groups.set(variantHash, cell)
    if (prepared.trace.storedVariantHash) cell.storedHashes.add(prepared.trace.storedVariantHash)
    cell.rawHashes.add(rawHash)
    cell.cases.add(`${prepared.trace.organizationId}:${prepared.trace.caseId}`)
    for (const event of prepared.filteredRaw) if (event.actor) cell.actors.add(event.actor)
    const cycle = cycleTimeOf(prepared.trace)
    if (cycle && (context.includeSyncRun || !cycle.sync)) cell.cycles.push(cycle.ms)
  }
  const tally = createSuppressionTally()
  const outcome = suppressCells(Array.from(groups.values()), (cell) => ({ key: cell.variantHash, cases: cell.cases, actors: cell.actors }), context.k, tally)
  const visible = outcome.visible.sort((left, right) => right.cases.size - left.cases.size || left.variantHash.localeCompare(right.variantHash))
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), XRAY_ANALYTICS_LIMITS.maxVariants)
  const shown = visible.slice(0, bounded)
  const hidden = visible.slice(bounded)
  const n = complete.length
  const visibleRawHashes = new Set<string>()
  for (const cell of visible) for (const hash of cell.rawHashes) visibleRawHashes.add(hash)
  return {
    ...buildEnvelope(context.envelope, n, tally.summary()),
    distinctVariants: outcome.anySuppressed
      ? { raw: visibleRawHashes.size, collapsed: visible.length }
      : { raw: rawHashes.size, collapsed: groups.size },
    truncatedCases: population.length - complete.length,
    items: shown.map((cell) => {
      const storedHashes = Array.from(cell.storedHashes).sort((left, right) => left.localeCompare(right))
      return {
        variantHash: cell.variantHash,
        rawVariantHashes: storedHashes.slice(0, XRAY_ANALYTICS_LIMITS.maxRawVariantHashes),
        rawVariantHashesTruncated: storedHashes.length > XRAY_ANALYTICS_LIMITS.maxRawVariantHashes,
        activityKeys: cell.activityKeys,
        cases: cell.cases.size,
        share: rate(cell.cases.size, n) ?? 0,
        cycleTime: summarizeDurations(cell.cycles),
      }
    }),
    omitted: {
      variants: hidden.length,
      cases: hidden.reduce((total, cell) => total + cell.cases.size, 0),
    },
  }
}

/** Re-applies a smaller `limit` to a variants result computed with a larger one. */
export function limitVariants(result: VariantsResult, limit: number): VariantsResult {
  const bounded = Math.min(Math.max(1, Math.trunc(limit)), XRAY_ANALYTICS_LIMITS.maxVariants)
  if (result.items.length <= bounded) return result
  const hidden = result.items.slice(bounded)
  return {
    ...result,
    items: result.items.slice(0, bounded),
    omitted: {
      variants: result.omitted.variants + hidden.length,
      cases: result.omitted.cases + hidden.reduce((total, item) => total + item.cases, 0),
    },
  }
}
