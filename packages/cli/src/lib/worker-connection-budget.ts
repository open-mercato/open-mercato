/**
 * Bound the DB-connection demand of background queue workers.
 *
 * Since #2970/#3011 each worker job builds its own request container, so its own
 * `EntityManager` checks out a dedicated pooled DB connection for the job's
 * duration. The peak connection demand of `worker --all` is therefore the sum of
 * every queue's concurrency. Nothing previously bounded that sum against the DB
 * pool (`DB_POOL_MAX`) or the database's global `max_connections`, so a storm of
 * slow/failing jobs could over-subscribe connections — thrashing on the worker's
 * own acquire timeout and, across the worker + web processes, starving the
 * request/onboarding path that shares the same database.
 *
 * These helpers derive a per-queue effective-concurrency plan whose total never
 * exceeds a connection budget (defaulting to the resolved pool max), while
 * guaranteeing every queue keeps at least one worker.
 */

export type WorkerQueueConcurrency = {
  queue: string
  concurrency: number
}

export type WorkerConcurrencyPlanEntry = {
  queue: string
  requested: number
  effective: number
}

export type WorkerConcurrencyPlan = {
  /** Connection budget the plan was fitted to. */
  budget: number
  /** Sum of requested concurrency across all queues. */
  totalRequested: number
  /** Sum of effective concurrency the plan grants. */
  totalEffective: number
  /** True when any queue's concurrency was reduced to fit the budget. */
  clamped: boolean
  /**
   * True when the budget is smaller than the number of queues, so the per-queue
   * floor of 1 forces the total above the budget. The caller should surface this
   * as a misconfiguration (raise `DB_POOL_MAX` or the budget).
   */
  belowQueueFloor: boolean
  entries: WorkerConcurrencyPlanEntry[]
}

function toPositiveInt(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  const floored = Math.floor(value)
  return floored > 0 ? floored : fallback
}

/**
 * Resolve the connection budget for background workers. Defaults to the resolved
 * DB pool max so the worker never tries to use more connections than its own pool
 * can hand out; override with `OM_WORKERS_DB_CONNECTION_BUDGET` (positive int).
 */
export function resolveWorkerConnectionBudget(
  env: NodeJS.ProcessEnv,
  poolMax: number,
): number {
  const safePoolMax = toPositiveInt(poolMax, 1)
  const raw = env.OM_WORKERS_DB_CONNECTION_BUDGET
  if (!raw) return safePoolMax
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : safePoolMax
}

/**
 * Fit per-queue concurrency to a connection budget.
 *
 * - Every queue keeps a floor of 1 worker (no queue is starved).
 * - No queue exceeds its requested concurrency.
 * - When the sum exceeds the budget, leftover capacity is distributed greedily to
 *   the queues furthest below their request, so the total matches the budget
 *   exactly (when `budget >= queueCount`) and the allocation is deterministic.
 */
export function planWorkerConcurrency(
  queues: WorkerQueueConcurrency[],
  budget: number,
): WorkerConcurrencyPlan {
  const safeBudget = toPositiveInt(budget, 1)
  const requested = queues.map((entry) => ({
    queue: entry.queue,
    requested: toPositiveInt(entry.concurrency, 1),
  }))
  const totalRequested = requested.reduce((sum, entry) => sum + entry.requested, 0)

  if (totalRequested <= safeBudget) {
    return {
      budget: safeBudget,
      totalRequested,
      totalEffective: totalRequested,
      clamped: false,
      belowQueueFloor: false,
      entries: requested.map((entry) => ({ ...entry, effective: entry.requested })),
    }
  }

  // Floor every queue at 1, then water-fill the remaining budget to the queues
  // with the largest unmet request first.
  const effective = requested.map(() => 1)
  let used = effective.length
  while (used < safeBudget) {
    let bestIndex = -1
    let bestDeficit = 0
    for (let index = 0; index < requested.length; index += 1) {
      const deficit = requested[index].requested - effective[index]
      if (deficit > bestDeficit) {
        bestDeficit = deficit
        bestIndex = index
      }
    }
    if (bestIndex === -1) break
    effective[bestIndex] += 1
    used += 1
  }

  const totalEffective = effective.reduce((sum, value) => sum + value, 0)
  return {
    budget: safeBudget,
    totalRequested,
    totalEffective,
    clamped: true,
    belowQueueFloor: requested.length > safeBudget,
    entries: requested.map((entry, index) => ({
      ...entry,
      effective: effective[index],
    })),
  }
}
