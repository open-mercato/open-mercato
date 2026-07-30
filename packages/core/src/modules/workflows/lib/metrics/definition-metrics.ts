/**
 * Per-definition operational KPIs (spec §8.5) — the PURE arithmetic half.
 *
 * This module contains no ORM, DI, React or registry import, so every rule it
 * encodes is unit-testable without a database. `lib/metrics/rollup-service.ts`
 * owns the queries and the upsert; this file owns what the numbers MEAN.
 *
 * Three honesty rules govern what may appear here:
 *
 * 1. **A metric is computed only from a column the engine actually writes.**
 *    `StepInstance.executionTimeMs` is deliberately NOT used: `exitStep` writes
 *    it on the COMPLETED path only, while every FAILED path
 *    (`step-handler`, `activity-worker-handler`, `condition-handler`) sets
 *    `exitedAt` and leaves it null. A p95 over that column would silently be a
 *    success-only latency wearing the name of a step latency. Run duration is
 *    measured instead, from `startedAt` → the terminal timestamp, both of which
 *    the engine always writes.
 * 2. **Dry runs never count.** `WorkflowInstance.isDryRun` is the flag
 *    (spec §8.2: "excludes the instance from KPIs"); the caller filters on it
 *    and the shapes below carry only already-filtered rows.
 * 3. **A denominator is always reported next to a rate.** `successRate` without
 *    `runsTerminal` and `taskSlaHitRate` without `tasksWithDeadline` are both
 *    unreadable — 100% over one run is not the same claim as 100% over 4,000.
 * 4. **A run that tolerated a failure is not a success.** `successRate` counts
 *    the run's VERDICT, not its lifecycle status: a `partial_failure` reached
 *    END but did not do everything it was asked to. It is reported as its own
 *    number (`runsPartialFailure`) rather than folded into either bucket.
 */

import type { WorkflowRunOutcome } from '../run-outcome'

/** Rollup window lengths, mirroring `AgentMetricRollup`'s window vocabulary. */
export const WORKFLOW_ROLLUP_WINDOW_MS = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
} as const

export type WorkflowRollupWindowKey = keyof typeof WORKFLOW_ROLLUP_WINDOW_MS

export const WORKFLOW_ROLLUP_WINDOW_KEYS = Object.keys(
  WORKFLOW_ROLLUP_WINDOW_MS,
) as WorkflowRollupWindowKey[]

/**
 * Bucket the window boundaries snap to. Recomputing the SAME `windowStart` is
 * what makes a repeated rollup pass an overwrite rather than a second row, so
 * the bucket — not the wall clock — is the row's identity.
 */
export const WORKFLOW_ROLLUP_BUCKET_MS = 15 * 60 * 1000

/** Snap a timestamp down to the rollup bucket grid. */
export function floorToRollupBucket(epochMs: number): number {
  return Math.floor(epochMs / WORKFLOW_ROLLUP_BUCKET_MS) * WORKFLOW_ROLLUP_BUCKET_MS
}

/**
 * Terminal statuses a run can reach.
 *
 * `COMPENSATED` is deliberately absent, and its absence is a documented engine
 * gap rather than an oversight: `compensation-handler` flips the status to
 * COMPENSATED but writes NO terminal timestamp, and `completeWorkflow` returns
 * before its own `completedAt` assignment on the compensating path. A run in
 * that state therefore has no instant to attribute to a window, so it can be
 * counted honestly in no window at all. Closing the gap means writing a
 * terminal timestamp in the compensation path, which is a state-machine change
 * (Ask First) and not this change.
 */
export const WORKFLOW_TERMINAL_STATUSES = ['COMPLETED', 'FAILED', 'CANCELLED'] as const

export type WorkflowTerminalStatus = (typeof WORKFLOW_TERMINAL_STATUSES)[number]

/** One terminal run, already scoped and already dry-run filtered by the caller. */
export type TerminalRunSample = {
  status: string
  /**
   * The run's VERDICT (`WorkflowInstance.outcome`), or null for a row written
   * before outcomes existed. Null is NOT read as `success`: a pre-upgrade
   * COMPLETED run counts exactly as it did before, so upgrading does not
   * retroactively rewrite a window's history.
   */
  outcome?: WorkflowRunOutcome | null
  startedAt: Date | null
  /** `completedAt` for COMPLETED/FAILED, `cancelledAt` for CANCELLED. */
  terminalAt: Date | null
}

/** One completed task carrying an authored deadline. */
export type TaskDeadlineSample = {
  dueDate: Date | null
  completedAt: Date | null
}

export type DefinitionMetrics = {
  /** Runs whose `startedAt` falls in the window. */
  runsStarted: number
  /** Runs whose terminal timestamp falls in the window — the rate denominator. */
  runsTerminal: number
  runsCompleted: number
  runsFailed: number
  runsCancelled: number
  /**
   * COMPLETED runs whose verdict is `partial_failure` — they reached END while
   * tolerating at least one activity or step failure.
   *
   * Its own number, folded into NEITHER bucket. It is not added to `runsFailed`
   * (the run did reach END, and a failure-queue count that included it would
   * disagree with the lifecycle) and it is excluded from `successRate`'s
   * numerator (the work it skipped never happened). It stays in `runsTerminal`,
   * so the denominators still add up.
   */
  runsPartialFailure: number
  /**
   * `(runsCompleted - runsPartialFailure) / runsTerminal`, or null when nothing
   * terminated.
   */
  successRate: number | null
  /** Terminal runs that also had a usable `startedAt` — the duration denominator. */
  durationSampleCount: number
  avgDurationMs: number | null
  p50DurationMs: number | null
  p95DurationMs: number | null
  /** Completed tasks that carried a `dueDate` — the SLA denominator. */
  tasksWithDeadline: number
  tasksMetDeadline: number
  /** `tasksMetDeadline / tasksWithDeadline`, or null when no task had a deadline. */
  taskSlaHitRate: number | null
}

export const EMPTY_DEFINITION_METRICS: DefinitionMetrics = {
  runsStarted: 0,
  runsTerminal: 0,
  runsCompleted: 0,
  runsFailed: 0,
  runsCancelled: 0,
  runsPartialFailure: 0,
  successRate: null,
  durationSampleCount: 0,
  avgDurationMs: null,
  p50DurationMs: null,
  p95DurationMs: null,
  tasksWithDeadline: 0,
  tasksMetDeadline: 0,
  taskSlaHitRate: null,
}

/**
 * Nearest-rank percentile over an unsorted sample; null when empty.
 *
 * Nearest rank (`percentile_disc` semantics) rather than interpolation, for the
 * same reason `agent_orchestrator`'s `percentileOf` chose it: every value it
 * returns is a duration some run actually took, which is what an operator
 * clicking through to that run needs to be true. It is also the variant that
 * behaves sanely on the small samples this rollup normally sees — a definition
 * with three runs a day has no meaningful interpolant.
 *
 * The rank is `ceil(fraction * n) - 1`, clamped into range, so p95 of a
 * one-element sample is that element and p95 of a 20-element sample is the
 * 19th-largest — never an off-by-one past the end of the array.
 */
export function percentileOf(values: number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1))
  return sorted[rank]
}

/** Mean of a sample, rounded to whole milliseconds; null when empty. */
export function meanOf(values: number[]): number | null {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return Math.round(total / values.length)
}

/**
 * A rate reported as a fraction in [0, 1], or null when the denominator is 0.
 *
 * Null rather than 0: "no runs finished" and "every run failed" are opposite
 * facts and a KPI card that paints both as 0% is worse than one that says it
 * has nothing to show.
 */
export function rateOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null
  return numerator / denominator
}

/**
 * Wall-clock run duration, or null when either end is missing or the pair is
 * inverted (a clock skew or a hand-edited row must not contribute a negative
 * sample that drags a mean below zero).
 */
export function runDurationMs(run: TerminalRunSample): number | null {
  if (!run.startedAt || !run.terminalAt) return null
  const durationMs = run.terminalAt.getTime() - run.startedAt.getTime()
  if (!Number.isFinite(durationMs) || durationMs < 0) return null
  return durationMs
}

/** True when a completed task landed on or before its authored deadline. */
export function taskMetDeadline(task: TaskDeadlineSample): boolean {
  if (!task.dueDate || !task.completedAt) return false
  return task.completedAt.getTime() <= task.dueDate.getTime()
}

export type DefinitionMetricsInput = {
  runsStarted: number
  terminalRuns: TerminalRunSample[]
  completedTasks: TaskDeadlineSample[]
}

/**
 * Fold the sampled rows into one window's metrics.
 *
 * Pure and total: given the same input it returns the same output, which is
 * precisely what lets the rollup worker recompute a bucket instead of
 * incrementing it.
 */
export function buildDefinitionMetrics(input: DefinitionMetricsInput): DefinitionMetrics {
  const terminalRuns = input.terminalRuns
  let runsCompleted = 0
  let runsFailed = 0
  let runsCancelled = 0
  let runsPartialFailure = 0
  const durations: number[] = []

  for (const run of terminalRuns) {
    if (run.status === 'COMPLETED') {
      runsCompleted += 1
      if (run.outcome === 'partial_failure') runsPartialFailure += 1
    }
    else if (run.status === 'FAILED') runsFailed += 1
    else if (run.status === 'CANCELLED') runsCancelled += 1
    const duration = runDurationMs(run)
    if (duration !== null) durations.push(duration)
  }

  const tasksWithDeadline = input.completedTasks.filter((task) => task.dueDate !== null).length
  const tasksMetDeadline = input.completedTasks.filter(
    (task) => task.dueDate !== null && taskMetDeadline(task),
  ).length

  return {
    runsStarted: input.runsStarted,
    runsTerminal: terminalRuns.length,
    runsCompleted,
    runsFailed,
    runsCancelled,
    runsPartialFailure,
    successRate: rateOf(runsCompleted - runsPartialFailure, terminalRuns.length),
    durationSampleCount: durations.length,
    avgDurationMs: meanOf(durations),
    p50DurationMs: percentileOf(durations, 0.5),
    p95DurationMs: percentileOf(durations, 0.95),
    tasksWithDeadline,
    tasksMetDeadline,
    taskSlaHitRate: rateOf(tasksMetDeadline, tasksWithDeadline),
  }
}
