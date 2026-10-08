import { buildEnvelope, type BuildContext } from './envelope'
import {
  createSuppressionTally,
  isLowConfidence,
  rate,
  suppressionReason,
  wilsonLowerBound,
  type SuppressionTally,
} from './stats'
import { completedInWindow, variantKeysOf, type PreparedCase } from './trace'
import {
  XRAY_ANALYTICS_LIMITS,
  XRAY_CONFORMANCE_MIN_COVERAGE,
  type ConformanceDeviationKind,
  type ConformanceModelResult,
  type ConformanceRefusalReason,
  type ConformanceResult,
  type DesignedProcessModel,
} from './types'

/** One completed case's observed steps (collapsed activity keys) and its actors. */
export type ConformanceTrace = {
  caseId: string
  organizationId: string
  activityKeys: string[]
  actors: string[]
}

export type ConformanceOptions = {
  models: readonly DesignedProcessModel[]
  caseModelKeys?: Readonly<Record<string, string>>
  k: number
  minCoverage?: number
}

export type ConformanceEvaluation =
  | { status: 'refused'; reason: ConformanceRefusalReason; coverage: number | null; suppression: SuppressionTally }
  | {
    status: 'ok'
    coverage: number
    unresolvedCases: number
    models: ConformanceModelResult[]
    unmappedActivities: Array<{ activityKey: string; events: number }>
    suppression: SuppressionTally
  }

type DeviationCell = {
  kind: ConformanceDeviationKind
  from: string | null
  to: string | null
  cases: Set<string>
  actors: Set<string>
}

/** A designed model for an ordered list of expected activity keys (each key is its own step). */
export function sequenceModel(
  activityKeys: readonly string[],
  source: DesignedProcessModel['source'] = { kind: 'sequence', definitionId: null, version: null },
  key = 'sequence',
): DesignedProcessModel {
  const steps = Array.from(new Set(activityKeys))
  const transitions: Array<[string, string]> = []
  for (let position = 1; position < activityKeys.length; position += 1) {
    transitions.push([activityKeys[position - 1], activityKeys[position]])
  }
  return {
    key,
    source,
    steps,
    transitions,
    startSteps: activityKeys.length > 0 ? [activityKeys[0]] : [],
    endSteps: activityKeys.length > 0 ? [activityKeys[activityKeys.length - 1]] : [],
    activityStepMap: Object.fromEntries(steps.map((step) => [step, step])),
  }
}

function resolveModel(trace: ConformanceTrace, options: ConformanceOptions): DesignedProcessModel | null {
  const assigned = options.caseModelKeys?.[trace.caseId]
  if (assigned !== undefined) return options.models.find((model) => model.key === assigned) ?? null
  return options.models.length === 1 ? options.models[0] : null
}

function mappedSteps(trace: ConformanceTrace, model: DesignedProcessModel): string[] {
  const steps: string[] = []
  for (const activityKey of trace.activityKeys) {
    const step = Object.prototype.hasOwnProperty.call(model.activityStepMap, activityKey) ? model.activityStepMap[activityKey] : undefined
    if (step === undefined) continue
    if (steps[steps.length - 1] !== step) steps.push(step)
  }
  return steps
}

function evaluateModel(
  model: DesignedProcessModel,
  traces: readonly ConformanceTrace[],
  k: number,
  tally: SuppressionTally,
): ConformanceModelResult {
  const starts = new Set(model.startSteps)
  const ends = new Set(model.endSteps)
  const allowed = new Set(model.transitions.map(([from, to]) => JSON.stringify([from, to])))
  const deviations = new Map<string, DeviationCell>()
  let conformingCases = 0
  let totalTransitions = 0
  let allowedTransitions = 0
  for (const trace of traces) {
    const caseKey = `${trace.organizationId}:${trace.caseId}`
    const steps = mappedSteps(trace, model)
    const found: Array<Pick<DeviationCell, 'kind' | 'from' | 'to'>> = []
    if (steps.length === 0 || !starts.has(steps[0])) found.push({ kind: 'invalid_start', from: null, to: steps[0] ?? null })
    for (let position = 1; position < steps.length; position += 1) {
      totalTransitions += 1
      if (allowed.has(JSON.stringify([steps[position - 1], steps[position]]))) allowedTransitions += 1
      else found.push({ kind: 'invalid_transition', from: steps[position - 1], to: steps[position] })
    }
    const last = steps[steps.length - 1]
    if (last !== undefined && !ends.has(last)) found.push({ kind: 'invalid_end', from: last, to: null })
    if (found.length === 0) conformingCases += 1
    for (const deviation of found) {
      const key = JSON.stringify([deviation.kind, deviation.from, deviation.to])
      const cell = deviations.get(key) ?? { ...deviation, cases: new Set<string>(), actors: new Set<string>() }
      deviations.set(key, cell)
      cell.cases.add(caseKey)
      for (const actor of trace.actors) cell.actors.add(actor)
    }
  }
  const visible: ConformanceModelResult['deviations'] = []
  for (const cell of deviations.values()) {
    const reason = suppressionReason({ cases: cell.cases.size, actors: cell.actors.size }, k)
    if (reason) {
      tally.record(reason)
      continue
    }
    visible.push({ kind: cell.kind, from: cell.from, to: cell.to, cases: cell.cases.size })
  }
  visible.sort((left, right) => right.cases - left.cases
    || left.kind.localeCompare(right.kind)
    || String(left.from).localeCompare(String(right.from))
    || String(left.to).localeCompare(String(right.to)))
  return {
    key: model.key,
    source: model.source,
    n: traces.length,
    conformingCases,
    fitness: rate(conformingCases, traces.length),
    fitnessLowerBound: wilsonLowerBound(conformingCases, traces.length),
    lowConfidence: isLowConfidence(traces.length),
    transitions: { total: totalTransitions, allowed: allowedTransitions },
    deviations: visible,
  }
}

/**
 * Compares completed traces with the designed model of the definition version each case
 * executed (`caseModelKeys`; a single model applies to every case). Coverage is the share of
 * observed steps that map onto a designed step; below `minCoverage` (60 %) the comparison is
 * refused rather than reporting a meaningless fitness. Unmapped steps are skipped, consecutive
 * steps mapping to one designed step are merged. A trace conforms when it starts at a start
 * step, moves only along designed transitions and ends at an end step.
 */
export function evaluateConformance(traces: readonly ConformanceTrace[], options: ConformanceOptions): ConformanceEvaluation {
  const tally = createSuppressionTally()
  const minCoverage = options.minCoverage ?? XRAY_CONFORMANCE_MIN_COVERAGE
  const byModel = new Map<string, { model: DesignedProcessModel; traces: ConformanceTrace[] }>()
  const unmapped = new Map<string, number>()
  let unresolvedCases = 0
  let observed = 0
  let mapped = 0
  for (const trace of traces) {
    const model = resolveModel(trace, options)
    if (!model) {
      unresolvedCases += 1
      continue
    }
    const entry = byModel.get(model.key) ?? { model, traces: [] }
    byModel.set(model.key, entry)
    entry.traces.push(trace)
    for (const activityKey of trace.activityKeys) {
      observed += 1
      if (Object.prototype.hasOwnProperty.call(model.activityStepMap, activityKey)) mapped += 1
      else unmapped.set(activityKey, (unmapped.get(activityKey) ?? 0) + 1)
    }
  }
  if (byModel.size === 0) return { status: 'refused', reason: 'no_cases', coverage: null, suppression: tally }
  const coverage = observed > 0 ? mapped / observed : 0
  if (coverage < minCoverage) return { status: 'refused', reason: 'insufficient_coverage', coverage, suppression: tally }
  const models = Array.from(byModel.values())
    .sort((left, right) => left.model.key.localeCompare(right.model.key))
    .map((entry) => evaluateModel(entry.model, entry.traces, options.k, tally))
  const unmappedActivities = Array.from(unmapped.entries())
    .map(([activityKey, events]) => ({ activityKey, events }))
    .sort((left, right) => right.events - left.events || left.activityKey.localeCompare(right.activityKey))
    .slice(0, XRAY_ANALYTICS_LIMITS.maxUnmappedActivities)
  return { status: 'ok', coverage, unresolvedCases, models, unmappedActivities, suppression: tally }
}

export function toConformanceTraces(cases: readonly PreparedCase[], context: Pick<BuildContext, 'window'>): { traces: ConformanceTrace[]; truncatedCases: number } {
  const population = cases.filter((prepared) => completedInWindow(prepared, context.window))
  const traces: ConformanceTrace[] = []
  for (const prepared of population) {
    if (!prepared.trace.complete) continue
    const actors = new Set<string>()
    for (const event of prepared.filteredRaw) if (event.actor) actors.add(event.actor)
    traces.push({
      caseId: prepared.trace.caseId,
      organizationId: prepared.trace.organizationId,
      activityKeys: variantKeysOf(prepared.filteredCollapsed),
      actors: Array.from(actors),
    })
  }
  return { traces, truncatedCases: population.length - traces.length }
}

/** Conformance of the cases completed in the window (complete traces only). */
export function buildConformance(
  cases: readonly PreparedCase[],
  context: BuildContext,
  options: Omit<ConformanceOptions, 'k'>,
): ConformanceResult {
  const { traces, truncatedCases } = toConformanceTraces(cases, context)
  const evaluation = evaluateConformance(traces, { ...options, k: context.k })
  const minCoverage = options.minCoverage ?? XRAY_CONFORMANCE_MIN_COVERAGE
  const envelope = buildEnvelope(context.envelope, traces.length, evaluation.suppression.summary())
  if (evaluation.status === 'refused') {
    return { ...envelope, status: 'refused', reason: evaluation.reason, coverage: evaluation.coverage, minCoverage, truncatedCases }
  }
  return {
    ...envelope,
    status: 'ok',
    coverage: evaluation.coverage,
    minCoverage,
    truncatedCases,
    unresolvedCases: evaluation.unresolvedCases,
    models: evaluation.models,
    unmappedActivities: evaluation.unmappedActivities,
  }
}
