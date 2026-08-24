/**
 * EP-51 — the recalculation registry.
 *
 * A recalculation is a tenant-wide restatement of a derived time-tracking value:
 * the module ships one, the retro-rounding pass behind
 * `POST /api/staff/timesheets/settings/reapply-rounding`, and a third party that
 * plugs in its own rate resolver (EP-33) or billability chain (EP-34) needs the
 * same thing — a way to re-apply the new rule to the rows that already exist,
 * with the progress bar, the cancel button and the queue worker the module
 * already has.
 *
 * The contract is deliberately narrow. A hook receives a scope and a reporter and
 * answers a count summary; it does NOT own the `ProgressJob`, because several
 * hooks share one job when the CLI runs them together, and a hook that started or
 * completed the job would fight the next one.
 *
 * **`run` is a write over a tenant's history.** Two rules that are not optional:
 * every query must carry `tenantId` (and honour `organizationIds` when it is not
 * `null`), and a locked entry — one frozen into a closed report — must never be
 * touched. The built-in excludes locked entries twice, in its own candidate query
 * and again in the command it drives.
 */

import type { AwilixContainer } from 'awilix'
import { extensionPoints } from '@open-mercato/core/modules/staff/extension-points'
import { createStrategyRegistry, BUILT_IN_STRATEGY_PRIORITY } from './registries/registry'

export const TIME_TRACKING_RECALCULATION_REGISTRY_ID =
  extensionPoints.hosts.recalculationRegistry.spotId

export const BUILT_IN_RECALCULATION_ID = 'staff.time_tracking.recalculation.rounding'

export type TimeTrackingRecalculationScope = {
  tenantId: string
  /** Organizations the caller may act in; `null` means every organization of the tenant. */
  organizationIds: string[] | null
  userId?: string | null
}

/**
 * The slice of the progress job a hook is allowed to touch. `advance` is additive
 * so two hooks sharing one job cannot rewind each other's count.
 */
export type TimeTrackingRecalculationReporter = {
  setTotal(total: number): Promise<void>
  advance(processed: number): Promise<void>
  isCancellationRequested(): Promise<boolean>
}

export type TimeTrackingRecalculationContext = {
  container: AwilixContainer
  scope: TimeTrackingRecalculationScope
  report: TimeTrackingRecalculationReporter
}

export type TimeTrackingRecalculationSummary = {
  totalCount: number
  processedCount: number
  updatedCount: number
  unchangedCount: number
  skippedCount: number
  cancelled: boolean
}

export type TimeTrackingRecalculation = {
  id: string
  labelKey: string
  priority?: number
  run(ctx: TimeTrackingRecalculationContext): Promise<TimeTrackingRecalculationSummary>
}

const registry = createStrategyRegistry<TimeTrackingRecalculation>(
  TIME_TRACKING_RECALCULATION_REGISTRY_ID,
)

export function registerTimeTrackingRecalculation(
  recalculation: TimeTrackingRecalculation,
): () => void {
  if (typeof recalculation?.run !== 'function') {
    throw new Error('[internal] a time-tracking recalculation must declare a run() function')
  }
  return registry.register(recalculation)
}

export function listTimeTrackingRecalculations(): TimeTrackingRecalculation[] {
  return registry.list()
}

export function timeTrackingRecalculationIds(): string[] {
  return registry.ids()
}

export function getTimeTrackingRecalculation(
  id: string | null | undefined,
): TimeTrackingRecalculation | null {
  return registry.get(id)
}

export function emptyRecalculationSummary(): TimeTrackingRecalculationSummary {
  return {
    totalCount: 0,
    processedCount: 0,
    updatedCount: 0,
    unchangedCount: 0,
    skippedCount: 0,
    cancelled: false,
  }
}

/**
 * Resolves the hooks a job should run.
 *
 * An empty or absent request resolves to the built-in alone — which is what keeps
 * the settings route byte-identical: it enqueues no hook ids, so a contribution
 * cannot attach itself to the retro-rounding button a tenant pressed. Running
 * more than one is an explicit act, and the CLI is where it is made.
 *
 * An unknown id is an error rather than a silent skip: a backfill that quietly
 * did nothing is worse than one that refused to start.
 */
export function resolveTimeTrackingRecalculations(
  ids?: readonly string[] | null,
): TimeTrackingRecalculation[] {
  if (!ids || ids.length === 0) {
    const builtIn = registry.get(BUILT_IN_RECALCULATION_ID)
    return builtIn ? [builtIn] : []
  }
  const resolved: TimeTrackingRecalculation[] = []
  for (const id of ids) {
    const entry = registry.get(id)
    if (!entry) throw new Error(`[internal] unknown time-tracking recalculation id: ${id}`)
    if (!resolved.some((candidate) => candidate.id === entry.id)) resolved.push(entry)
  }
  return resolved
}
