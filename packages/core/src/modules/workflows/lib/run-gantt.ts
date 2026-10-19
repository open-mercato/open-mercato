/**
 * Run Gantt model (spec §8.3) — PURE.
 *
 * > "**Timeline** — a true clock-time **Gantt** (bars per step/activity/task/
 * > signal, parallel branches as overlapping lanes, with collapsed-wait
 * > rendering so a 3-day task deadline doesn't flatten the rest; this is what
 * > makes latency and human-wait visible)"
 *
 * Two problems the naive version does not solve.
 *
 * **Collapsed waits.** A run that spends 1s executing and three days waiting
 * for an approval is 99.999% wait on a linear axis: every automated step
 * collapses to a sub-pixel sliver and the chart shows nothing. So the axis is
 * PIECEWISE-LINEAR. The run is cut at every start and end into slices; a slice
 * longer than the collapse threshold is rendered at the threshold's width and
 * flagged, so the wait is visible AS a wait without eating the chart. Time is
 * still monotonic and every bar keeps its true duration in `durationMs` — the
 * compression is a rendering decision, never a reported number.
 *
 * **Lanes.** Parallel branches genuinely overlap in clock time, so they cannot
 * share a row. Bars are grouped by `branchInstanceId` (the engine's own branch
 * token) and packed greedily inside each group, which keeps one branch reading
 * top-to-bottom instead of scattering it across the chart.
 */

import type { StepRunStatus } from './status-colors'
import { stepInstanceStatusToRunStatus, type RunStepInstanceInput } from './run-execution'
import { toMillis } from './run-duration'

/** A slice shorter than this is never compressed — sub-second runs stay linear. */
export const MIN_COLLAPSIBLE_MS = 1000

/**
 * How many times the typical slice a slice must exceed before it is treated as
 * a wait rather than work. Four is deliberately conservative: it collapses the
 * three-day approval and leaves an ordinary slow HTTP call alone.
 */
export const COLLAPSE_FACTOR = 4

export type GanttBar = {
  key: string
  stepId: string
  stepName: string
  stepType: string
  status: StepRunStatus
  branchInstanceId: string | null
  lane: number
  startMs: number
  endMs: number
  /** TRUE elapsed time. Never the compressed one. */
  durationMs: number
  /** Position across the rendered (compressed) axis, 0..1. */
  offsetRatio: number
  widthRatio: number
  /** The bar spans at least one collapsed slice, i.e. most of it is waiting. */
  spansCollapsedWait: boolean
  /** The step had not finished when the model was built. */
  running: boolean
}

export type GanttCollapsedSegment = {
  startMs: number
  endMs: number
  skippedMs: number
  offsetRatio: number
  widthRatio: number
}

export type GanttModel = {
  bars: GanttBar[]
  laneCount: number
  startMs: number
  endMs: number
  /** True wall-clock span of the run. */
  totalDurationMs: number
  collapsedSegments: GanttCollapsedSegment[]
  /** Sum of everything the collapsed segments hide, for the "N hidden" caption. */
  collapsedDurationMs: number
}

type Slice = {
  startMs: number
  endMs: number
  durationMs: number
  weight: number
  collapsed: boolean
  renderedStart: number
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const ordered = [...values].sort((left, right) => left - right)
  const middle = Math.floor(ordered.length / 2)
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle]
}

function resolveCollapseThreshold(sliceDurations: readonly number[]): number {
  const positive = sliceDurations.filter((duration) => duration > 0)
  if (positive.length === 0) return Number.POSITIVE_INFINITY
  return Math.max(MIN_COLLAPSIBLE_MS, median(positive) * COLLAPSE_FACTOR)
}

function buildSlices(boundaries: readonly number[]): Slice[] {
  const rawDurations: number[] = []
  for (let index = 1; index < boundaries.length; index += 1) {
    rawDurations.push(boundaries[index] - boundaries[index - 1])
  }
  const threshold = resolveCollapseThreshold(rawDurations)

  const slices: Slice[] = []
  let renderedStart = 0
  for (let index = 1; index < boundaries.length; index += 1) {
    const startMs = boundaries[index - 1]
    const endMs = boundaries[index]
    const durationMs = endMs - startMs
    const collapsed = durationMs > threshold
    const weight = collapsed ? threshold : durationMs
    slices.push({ startMs, endMs, durationMs, weight, collapsed, renderedStart })
    renderedStart += weight
  }
  return slices
}

function renderedTotal(slices: readonly Slice[]): number {
  return slices.reduce((total, slice) => total + slice.weight, 0)
}

/** Map a wall-clock instant onto the compressed axis, in rendered units. */
function projectToRendered(slices: readonly Slice[], atMs: number): number {
  if (slices.length === 0) return 0
  if (atMs <= slices[0].startMs) return 0
  const last = slices[slices.length - 1]
  if (atMs >= last.endMs) return last.renderedStart + last.weight

  for (const slice of slices) {
    if (atMs >= slice.startMs && atMs <= slice.endMs) {
      if (slice.durationMs === 0) return slice.renderedStart
      const progress = (atMs - slice.startMs) / slice.durationMs
      return slice.renderedStart + progress * slice.weight
    }
  }
  return last.renderedStart + last.weight
}

type BarSeed = {
  key: string
  stepId: string
  stepName: string
  stepType: string
  status: StepRunStatus
  branchInstanceId: string | null
  startMs: number
  endMs: number
  running: boolean
}

/**
 * Lanes per branch: every bar carrying the same `branchInstanceId` is packed
 * into that branch's own block of lanes, so a parallel branch reads as one
 * band rather than being scattered across the chart by a global packer.
 */
function assignLanes(seeds: readonly BarSeed[]): Map<string, number> {
  const laneByKey = new Map<string, number>()
  const groups = new Map<string, BarSeed[]>()
  const groupOrder: string[] = []

  for (const seed of seeds) {
    const groupKey = seed.branchInstanceId ?? '__main__'
    const existing = groups.get(groupKey)
    if (existing) {
      existing.push(seed)
    } else {
      groups.set(groupKey, [seed])
      groupOrder.push(groupKey)
    }
  }

  let nextLaneBase = 0
  for (const groupKey of groupOrder) {
    const groupSeeds = groups.get(groupKey) ?? []
    const laneEnds: number[] = []
    for (const seed of groupSeeds) {
      let lane = laneEnds.findIndex((endMs) => endMs <= seed.startMs)
      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(seed.endMs)
      } else {
        laneEnds[lane] = seed.endMs
      }
      laneByKey.set(seed.key, nextLaneBase + lane)
    }
    nextLaneBase += Math.max(laneEnds.length, 1)
  }

  return laneByKey
}

export type BuildGanttInput = {
  stepInstances: readonly RunStepInstanceInput[]
  /** Instance start, so the axis begins where the run began even if step 1 is late. */
  instanceStartedAt?: string | Date | null
  instanceCompletedAt?: string | Date | null
  /** Injected for determinism — an unfinished step is measured against this. */
  now?: number
}

export function buildRunGantt(input: BuildGanttInput): GanttModel {
  const now = input.now ?? Date.now()

  const seeds: BarSeed[] = []
  for (const [index, stepInstance] of input.stepInstances.entries()) {
    const startMs = toMillis(stepInstance.enteredAt)
    if (startMs === null) continue
    const recordedEnd = toMillis(stepInstance.exitedAt)
    const running = recordedEnd === null
    const endMs = Math.max(recordedEnd ?? now, startMs)
    seeds.push({
      key: stepInstance.id ?? `${stepInstance.stepId}-${index}`,
      stepId: stepInstance.stepId,
      stepName: stepInstance.stepName || stepInstance.stepId,
      stepType: stepInstance.stepType || '',
      status: stepInstanceStatusToRunStatus(stepInstance.status),
      branchInstanceId: stepInstance.branchInstanceId ?? null,
      startMs,
      endMs,
      running,
    })
  }

  seeds.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)

  const instanceStart = toMillis(input.instanceStartedAt)
  const instanceEnd = toMillis(input.instanceCompletedAt)

  const candidateStarts = seeds.map((seed) => seed.startMs)
  const candidateEnds = seeds.map((seed) => seed.endMs)
  if (instanceStart !== null) candidateStarts.push(instanceStart)
  if (instanceEnd !== null) candidateEnds.push(instanceEnd)

  if (candidateStarts.length === 0) {
    return {
      bars: [],
      laneCount: 0,
      startMs: 0,
      endMs: 0,
      totalDurationMs: 0,
      collapsedSegments: [],
      collapsedDurationMs: 0,
    }
  }

  const startMs = Math.min(...candidateStarts)
  const endMs = Math.max(...candidateEnds, startMs)

  const boundarySet = new Set<number>([startMs, endMs])
  for (const seed of seeds) {
    boundarySet.add(seed.startMs)
    boundarySet.add(seed.endMs)
  }
  const boundaries = [...boundarySet].sort((left, right) => left - right)

  const slices = buildSlices(boundaries)
  const total = renderedTotal(slices)
  const toRatio = (atMs: number) => (total > 0 ? projectToRendered(slices, atMs) / total : 0)

  const laneByKey = assignLanes(seeds)

  const bars: GanttBar[] = seeds.map((seed) => {
    const offsetRatio = toRatio(seed.startMs)
    const endRatio = toRatio(seed.endMs)
    const spansCollapsedWait = slices.some(
      (slice) => slice.collapsed && slice.startMs >= seed.startMs && slice.endMs <= seed.endMs
    )
    return {
      key: seed.key,
      stepId: seed.stepId,
      stepName: seed.stepName,
      stepType: seed.stepType,
      status: seed.status,
      branchInstanceId: seed.branchInstanceId,
      lane: laneByKey.get(seed.key) ?? 0,
      startMs: seed.startMs,
      endMs: seed.endMs,
      durationMs: seed.endMs - seed.startMs,
      offsetRatio,
      widthRatio: Math.max(endRatio - offsetRatio, 0),
      spansCollapsedWait,
      running: seed.running,
    }
  })

  const collapsedSegments: GanttCollapsedSegment[] = slices
    .filter((slice) => slice.collapsed)
    .map((slice) => ({
      startMs: slice.startMs,
      endMs: slice.endMs,
      skippedMs: slice.durationMs - slice.weight,
      offsetRatio: total > 0 ? slice.renderedStart / total : 0,
      widthRatio: total > 0 ? slice.weight / total : 0,
    }))

  return {
    bars,
    laneCount: bars.reduce((highest, bar) => Math.max(highest, bar.lane + 1), 0),
    startMs,
    endMs,
    totalDurationMs: endMs - startMs,
    collapsedSegments,
    collapsedDurationMs: collapsedSegments.reduce((total_, segment) => total_ + segment.skippedMs, 0),
  }
}
