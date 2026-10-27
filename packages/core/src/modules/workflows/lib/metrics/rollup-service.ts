/**
 * Per-definition KPI rollup (spec §8.5) — the data-access half.
 *
 * The arithmetic lives in `./definition-metrics` and is pure; everything here is
 * about reading the right rows and writing the bucket exactly once.
 *
 * **Idempotency contract.** A pass never increments anything. It snaps the
 * window boundaries to `WORKFLOW_ROLLUP_BUCKET_MS`, RECOMPUTES the whole window
 * from the source rows, and writes the result at
 * `(tenantId, organizationId, workflowId, windowKey, windowStart)` — a key the
 * database enforces as unique. Running the same pass twice inside one bucket
 * therefore produces byte-identical rows and never a duplicate; running it after
 * the bucket rolls over produces a NEW row for the new bucket rather than
 * mutating history.
 *
 * **Scoping contract.** Every query below carries `tenantId` AND
 * `organizationId`. The worker enumerates scopes and calls this per scope; it
 * never widens a query to "all tenants" and then partitions in JS.
 *
 * **Dry-run contract.** `isDryRun: false` is on every instance query, and the
 * task query reaches tasks only through the ids of those instances — so a dry
 * run cannot contribute a run, a duration or an SLA sample by any path.
 */

import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { UserTask, WorkflowDefinitionMetricRollup, WorkflowInstance } from '../../data/entities'
import {
  WORKFLOW_ROLLUP_WINDOW_KEYS,
  WORKFLOW_ROLLUP_WINDOW_MS,
  WORKFLOW_TERMINAL_STATUSES,
  buildDefinitionMetrics,
  floorToRollupBucket,
  type DefinitionMetrics,
  type WorkflowRollupWindowKey,
} from './definition-metrics'

const logger = createLogger('workflows')

export type RollupScope = {
  tenantId: string
  organizationId: string
}

/**
 * Read-side scope.
 *
 * A rollup ROW is always per-organization, but a reader's organization scope can
 * legitimately cover several organizations (`filterIds`) or every organization in
 * the tenant (an unrestricted scope). Counts across organizations would sum, but
 * a percentile would not — a p95 cannot be recovered from three stored p95s — so
 * a multi-organization read is answered by live compute over the resolved set
 * rather than by pretending the rollup covers it. `organizationIds: undefined`
 * means "every organization in this tenant"; `tenantId` is never optional, so no
 * shape of this type can escape the tenant.
 */
export type MetricsReadScope = {
  tenantId: string
  organizationIds?: string[]
}

function organizationFilter(scope: MetricsReadScope): { organizationId?: { $in: string[] } } {
  return scope.organizationIds ? { organizationId: { $in: scope.organizationIds } } : {}
}

export type RollupWindowBounds = {
  windowKey: WorkflowRollupWindowKey
  windowStart: Date
  windowEnd: Date
}

/**
 * How many instances one window's duration sample may draw from. A percentile
 * needs the values, not a count, so this is the one query that cannot be a
 * `COUNT(*)`; the cap keeps a pathological definition from pulling a month of
 * rows into memory. Exceeding it biases the sample toward the NEWEST runs,
 * which is the least misleading truncation available and is reported to the
 * reader through `durationSampleCount` sitting beside the percentile.
 */
export const ROLLUP_DURATION_SAMPLE_LIMIT = 5000

/** How many tasks one window's SLA hit-rate may draw from, for the same reason. */
export const ROLLUP_TASK_SAMPLE_LIMIT = 5000

/** Resolve the bucket-aligned bounds of every rollup window at `nowMs`. */
export function resolveWindowBounds(nowMs: number): RollupWindowBounds[] {
  const windowEndMs = floorToRollupBucket(nowMs)
  return WORKFLOW_ROLLUP_WINDOW_KEYS.map((windowKey) => ({
    windowKey,
    windowStart: new Date(windowEndMs - WORKFLOW_ROLLUP_WINDOW_MS[windowKey]),
    windowEnd: new Date(windowEndMs),
  }))
}

/**
 * Logical workflow ids that have any non-dry-run activity in the widest window.
 *
 * Bounded by the widest window rather than by all history so a workflow retired
 * a year ago stops costing a row every quarter of an hour.
 */
export async function listActiveWorkflowIds(
  em: EntityManager,
  scope: RollupScope,
  since: Date,
): Promise<string[]> {
  const rows = await em.find(
    WorkflowInstance,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      isDryRun: false,
      deletedAt: null,
      startedAt: { $gte: since },
    },
    { fields: ['workflowId'] },
  )
  return Array.from(new Set(rows.map((row) => row.workflowId))).sort((left, right) =>
    left.localeCompare(right),
  )
}

/**
 * Compute one workflow's metrics for one window, straight from the source rows.
 *
 * Also the live-compute fallback the read route uses when no fresh rollup row
 * exists, which is what keeps the two paths from disagreeing: there is one
 * implementation of "what do these numbers mean", not two.
 */
export async function computeDefinitionMetrics(
  em: EntityManager,
  scope: MetricsReadScope,
  args: { workflowId: string; windowStart: Date; windowEnd: Date },
): Promise<DefinitionMetrics> {
  const baseScope = {
    tenantId: scope.tenantId,
    ...organizationFilter(scope),
    workflowId: args.workflowId,
    isDryRun: false,
    deletedAt: null,
  } as const
  const window = { $gte: args.windowStart, $lt: args.windowEnd }

  const runsStarted = await em.count(WorkflowInstance, {
    ...baseScope,
    startedAt: window,
  })

  // A run is "terminal in this window" by its terminal TIMESTAMP, never by its
  // status alone — a run that failed last month is not this week's failure.
  // `completedAt` covers COMPLETED, FAILED and COMPENSATED, `cancelledAt`
  // covers CANCELLED. A run compensated before the engine started stamping a
  // terminal timestamp has neither, so it matches nothing here and falls into
  // no window — unchanged, and deliberately not backfilled.
  const terminalInstances = await em.find(
    WorkflowInstance,
    {
      ...baseScope,
      status: { $in: [...WORKFLOW_TERMINAL_STATUSES] },
      $or: [{ completedAt: window }, { cancelledAt: window }],
    },
    {
      orderBy: { startedAt: 'DESC' },
      limit: ROLLUP_DURATION_SAMPLE_LIMIT,
      fields: ['id', 'status', 'outcome', 'startedAt', 'completedAt', 'cancelledAt'],
    },
  )

  const terminalRuns = terminalInstances.map((instance) => ({
    status: instance.status,
    outcome: instance.outcome ?? null,
    startedAt: instance.startedAt ?? null,
    terminalAt: instance.completedAt ?? instance.cancelledAt ?? null,
  }))

  // Tasks carry no workflow id of their own, so they are reached through the
  // instances above. That indirection is also what excludes dry runs from the
  // SLA metric structurally rather than by a second flag: a dry run creates no
  // task row at all, and the instance ids fed in here are already dry-run free.
  const instanceIds = terminalInstances.map((instance) => instance.id)
  const completedTasks = instanceIds.length
    ? await em.find(
        UserTask,
        {
          tenantId: scope.tenantId,
          ...organizationFilter(scope),
          workflowInstanceId: { $in: instanceIds },
          status: 'COMPLETED',
          dueDate: { $ne: null },
          completedAt: window,
        },
        { limit: ROLLUP_TASK_SAMPLE_LIMIT, fields: ['dueDate', 'completedAt'] },
      )
    : []

  return buildDefinitionMetrics({
    runsStarted,
    terminalRuns,
    completedTasks: completedTasks.map((task) => ({
      dueDate: task.dueDate ?? null,
      completedAt: task.completedAt ?? null,
    })),
  })
}

/**
 * Write (or overwrite) one bucket's row.
 *
 * Read-then-write against the unique key. The constraint is the real guarantee;
 * this lookup only avoids the round trip through a conflict in the common case.
 */
async function upsertRollup(
  em: EntityManager,
  scope: RollupScope,
  args: { workflowId: string; bounds: RollupWindowBounds; metrics: DefinitionMetrics; now: Date },
): Promise<void> {
  const key = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    workflowId: args.workflowId,
    windowKey: args.bounds.windowKey,
    windowStart: args.bounds.windowStart,
  }
  const existing = await em.findOne(WorkflowDefinitionMetricRollup, key)
  if (existing) {
    existing.windowEnd = args.bounds.windowEnd
    existing.computedAt = args.now
    existing.metrics = { ...args.metrics }
    em.persist(existing)
    return
  }
  em.persist(
    em.create(WorkflowDefinitionMetricRollup, {
      ...key,
      windowEnd: args.bounds.windowEnd,
      computedAt: args.now,
      metrics: { ...args.metrics },
      createdAt: args.now,
    }),
  )
}

export type RollupPassResult = {
  workflowIds: number
  written: number
}

/**
 * One rollup pass for one tenant + organization.
 *
 * Returns counts rather than rows so the worker can log a one-line summary
 * without holding the whole result set.
 */
export async function writeRollupsForScope(
  em: EntityManager,
  scope: RollupScope,
  options: { now?: Date } = {},
): Promise<RollupPassResult> {
  const now = options.now ?? new Date()
  const bounds = resolveWindowBounds(now.getTime())
  const widest = bounds.reduce((oldest, candidate) =>
    candidate.windowStart < oldest.windowStart ? candidate : oldest,
  )

  const workflowIds = await listActiveWorkflowIds(em, scope, widest.windowStart)
  let written = 0

  const readScope: MetricsReadScope = {
    tenantId: scope.tenantId,
    organizationIds: [scope.organizationId],
  }

  for (const workflowId of workflowIds) {
    for (const windowBounds of bounds) {
      const metrics = await computeDefinitionMetrics(em, readScope, {
        workflowId,
        windowStart: windowBounds.windowStart,
        windowEnd: windowBounds.windowEnd,
      })
      await upsertRollup(em, scope, { workflowId, bounds: windowBounds, metrics, now })
      written += 1
    }
  }

  await em.flush()
  logger.debug('Wrote workflow definition metric rollups', {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    workflowIds: workflowIds.length,
    written,
  })
  return { workflowIds: workflowIds.length, written }
}
