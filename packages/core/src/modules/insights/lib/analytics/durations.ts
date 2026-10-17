import { buildEnvelope, type BuildContext } from './envelope'
import {
  buildHistogram,
  createSuppressionTally,
  guardDurationStats,
  histogramFromCounts,
  summarizeDurations,
  suppressCells,
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

type CompletedView = NonNullable<DurationsResult['completed']>

type OpenView = NonNullable<DurationsResult['open']>

function emptyCompleted(): CompletedCell {
  return { cycles: [], excludedSyncRun: 0, cases: new Set(), actors: new Set() }
}

function completedView(cell: CompletedCell): CompletedView {
  return {
    empty: cell.cases.size === 0,
    stats: summarizeDurations(cell.cycles),
    histogram: buildHistogram(cell.cycles),
    excludedSyncRun: cell.excludedSyncRun,
  }
}

function openView(asOf: string, cell: OpenCensusCell): OpenView {
  return {
    empty: cell.n === 0,
    censored: true,
    asOf,
    stats: guardDurationStats(cell.n, cell.medianMs, cell.p90Ms),
    histogram: histogramFromCounts(cell.buckets),
  }
}

function emptyOpenCell(): OpenCensusCell {
  return { n: 0, medianMs: null, p90Ms: null, buckets: {} }
}

function guardedOverall<TView extends { empty: boolean }>(view: TView, facts: { cases: number; actors: number }, k: number, tally: SuppressionTally): TView | null {
  if (view.empty) return view
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
 * breakdown against Simpson's paradox). A cell without cases is an explicit empty marker
 * (`empty: true`), never suppressed; any other cell below the k / distinct-actor thresholds is
 * `null`. Organizations get complementary suppression (no visible organization plus the overall
 * figure may single out a small one); the overall cell is suppressed under the same rule, so in
 * a single-organization scope it shares the organization's decision. Open cases carry no actor
 * facts, so only k applies to them.
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
  const completedCells = organizationIds
    .map((organizationId) => ({ organizationId, cell: perOrganization.get(organizationId) ?? emptyCompleted() }))
    .filter((entry) => entry.cell.cases.size > 0)
  const openCells = organizationIds
    .map((organizationId) => ({ organizationId, cell: census.byOrganization.get(organizationId) ?? emptyOpenCell() }))
    .filter((entry) => entry.cell.n > 0)
  const visibleCompleted = new Set(suppressCells(
    completedCells,
    (entry) => ({ key: entry.organizationId, cases: entry.cell.cases, actors: entry.cell.actors }),
    context.k,
    tally,
  ).visible.map((entry) => entry.organizationId))
  const visibleOpen = new Set(suppressCells(
    openCells,
    (entry) => ({ key: entry.organizationId, cases: entry.cell.n, actors: 0 }),
    context.k,
    tally,
  ).visible.map((entry) => entry.organizationId))
  const byOrganization = organizationIds.map((organizationId) => {
    const completed = perOrganization.get(organizationId) ?? emptyCompleted()
    const open = census.byOrganization.get(organizationId) ?? emptyOpenCell()
    return {
      organizationId,
      completed: completed.cases.size === 0 || visibleCompleted.has(organizationId) ? completedView(completed) : null,
      open: open.n === 0 || visibleOpen.has(organizationId) ? openView(census.asOf, open) : null,
    }
  })
  const completed = guardedOverall(completedView(overall), { cases: overall.cases.size, actors: overall.actors.size }, context.k, tally)
  const open = guardedOverall(openView(census.asOf, census.overall), { cases: census.overall.n, actors: 0 }, context.k, tally)
  return {
    ...buildEnvelope(context.envelope, population.length, tally.summary()),
    includeSyncRun: context.includeSyncRun,
    truncatedCases,
    completed,
    open,
    byOrganization,
  }
}
