import { buildEnvelope, type BuildContext } from './envelope'
import {
  buildHistogram,
  createSuppressionTally,
  guardDurationStats,
  histogramFromCounts,
  summarizeDurations,
  suppressionReason,
  type SuppressionTally,
} from './stats'
import { completedInWindow, cycleTimeOf, type PreparedCase } from './trace'
import type { DurationsResult, XrayAgeBucket } from './types'

/** Aggregates of the cases still open at `asOf`, computed in SQL from the case summaries. */
export type OpenCensusCell = {
  n: number
  medianMs: number | null
  p90Ms: number | null
  buckets: Partial<Record<XrayAgeBucket, number>>
}

export type OpenCensus = {
  asOf: string
  overall: OpenCensusCell
  byOrganization: ReadonlyMap<string, OpenCensusCell>
}

type CompletedCell = {
  cycles: number[]
  excludedSyncRun: number
  cases: Set<string>
  actors: Set<string>
}

type CompletedView = DurationsResult['completed']

type OpenView = DurationsResult['open']

function emptyCompleted(): CompletedCell {
  return { cycles: [], excludedSyncRun: 0, cases: new Set(), actors: new Set() }
}

function completedView(cell: CompletedCell): CompletedView {
  return { stats: summarizeDurations(cell.cycles), histogram: buildHistogram(cell.cycles), excludedSyncRun: cell.excludedSyncRun }
}

function openView(asOf: string, cell: OpenCensusCell): OpenView {
  return {
    censored: true,
    asOf,
    stats: guardDurationStats(cell.n, cell.medianMs, cell.p90Ms),
    histogram: histogramFromCounts(cell.buckets),
  }
}

function emptyOpenCell(): OpenCensusCell {
  return { n: 0, medianMs: null, p90Ms: null, buckets: {} }
}

function guarded<TView>(view: TView, facts: { cases: number; actors: number }, k: number, tally: SuppressionTally): TView | null {
  const reason = suppressionReason(facts, k)
  if (!reason) return view
  tally.record(reason)
  return null
}

/**
 * Cycle times of the cases completed in the window (completed cases only) and, separately,
 * the right-censored ages of the cases still open at the window end (or now, if earlier),
 * with their age histogram. `sync_run` durations (a case started or ended by a sync run) are
 * excluded unless requested. Every figure is also split per organization (the default
 * breakdown against Simpson's paradox); a per-organization part below the k / distinct-actor
 * thresholds is `null` (suppressed). Open cases carry no actor facts, so only k applies to them.
 */
export function buildDurations(cases: readonly PreparedCase[], context: BuildContext, census: OpenCensus): DurationsResult {
  const population = cases.filter((prepared) => completedInWindow(prepared, context.window))
  const overall = emptyCompleted()
  const perOrganization = new Map<string, CompletedCell>()
  let truncatedCases = 0
  for (const prepared of population) {
    const trace = prepared.trace
    if (!trace.complete) truncatedCases += 1
    const cycle = cycleTimeOf(trace)
    if (!cycle) continue
    const cell = perOrganization.get(trace.organizationId) ?? emptyCompleted()
    perOrganization.set(trace.organizationId, cell)
    const caseKey = `${trace.organizationId}:${trace.caseId}`
    for (const target of [overall, cell]) {
      target.cases.add(caseKey)
      for (const event of prepared.filteredRaw) if (event.actor) target.actors.add(event.actor)
      if (cycle.sync && !context.includeSyncRun) target.excludedSyncRun += 1
      else target.cycles.push(cycle.ms)
    }
  }
  const tally = createSuppressionTally()
  const organizationIds = Array.from(new Set([...perOrganization.keys(), ...census.byOrganization.keys()]))
    .sort((left, right) => left.localeCompare(right))
  const byOrganization = organizationIds.map((organizationId) => {
    const completed = perOrganization.get(organizationId) ?? emptyCompleted()
    const open = census.byOrganization.get(organizationId) ?? emptyOpenCell()
    return {
      organizationId,
      completed: guarded(completedView(completed), { cases: completed.cases.size, actors: completed.actors.size }, context.k, tally),
      open: guarded(openView(census.asOf, open), { cases: open.n, actors: 0 }, context.k, tally),
    }
  })
  return {
    ...buildEnvelope(context.envelope, population.length, tally.summary()),
    includeSyncRun: context.includeSyncRun,
    truncatedCases,
    completed: completedView(overall),
    open: openView(census.asOf, census.overall),
    byOrganization,
  }
}
