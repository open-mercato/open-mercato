import type { EntityManager } from '@mikro-orm/postgresql'
import { AgentRun, AgentCorrection, AgentProposal, AgentMetricRollup } from '../../data/entities'
import type { AgentMetricRollupMetrics } from '../../data/validators'

export type MetricScope = { tenantId: string; organizationId: string }

/** The relative windows the /agents/:id/metrics endpoint can serve. */
export const ROLLUP_WINDOW_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
}

/**
 * Rollups are bucketed to this boundary so a re-run within the same bucket
 * recomputes the SAME `(windowStart, windowEnd)` row instead of inserting a new
 * one — that boundary is what makes the upsert idempotent. Defaults to the
 * scheduler's 300s interval; align them if the interval changes.
 */
export const ROLLUP_BUCKET_MS = 5 * 60 * 1000

/** Floor a timestamp to the rollup bucket boundary. */
function floorToBucket(ms: number): number {
  return Math.floor(ms / ROLLUP_BUCKET_MS) * ROLLUP_BUCKET_MS
}

/**
 * Compute the per-agent KPIs over `[since, until)` — lifted verbatim from the
 * live compute in api/agents/[id]/metrics/route.ts so the worker (writes
 * rollups) and the metrics route (live fallback) share one implementation. All
 * reads are non-encrypted aggregate columns, so plain em.find/count is correct.
 */
export async function computeAgentMetrics(
  em: EntityManager,
  scope: MetricScope,
  options: { agentId: string; since: Date; until?: Date },
): Promise<AgentMetricRollupMetrics> {
  const { agentId, since } = options
  const createdAt = options.until ? { $gte: since, $lt: options.until } : { $gte: since }

  const runs = await em.find(
    AgentRun,
    { ...scope, agentId, createdAt, deletedAt: null },
    { orderBy: { createdAt: 'desc' } },
  )

  const totalRuns = runs.length
  const evaluated = runs.filter((run) => run.evalPassed !== null && run.evalPassed !== undefined)
  const evalPassRate = evaluated.length
    ? evaluated.filter((run) => run.evalPassed === true).length / evaluated.length
    : null

  const runIds = runs.map((run) => run.id)
  const overrides = runIds.length
    ? await em.count(AgentCorrection, { ...scope, agentRunId: { $in: runIds } })
    : 0
  const overrideRate = totalRuns ? overrides / totalRuns : null

  const latencies = runs.map((run) => run.latencyMs).filter((n): n is number => typeof n === 'number')
  const avgLatencyMs = latencies.length ? latencies.reduce((sum, n) => sum + n, 0) / latencies.length : null
  const costMinorTotal = runs.reduce((sum, run) => sum + (typeof run.costMinor === 'number' ? run.costMinor : 0), 0)

  const proposalWindow = { ...scope, agentId, createdAt }
  const [unchanged, changed] = await Promise.all([
    em.count(AgentProposal, { ...proposalWindow, disposition: { $in: ['approved', 'auto_approved'] } }),
    em.count(AgentProposal, { ...proposalWindow, disposition: { $in: ['edited', 'rejected'] } }),
  ])
  const disposedProposals = unchanged + changed
  const approveUnchangedRate = disposedProposals ? unchanged / disposedProposals : null

  return {
    totalRuns,
    evaluatedRuns: evaluated.length,
    evalPassRate,
    overrides,
    overrideRate,
    avgLatencyMs,
    costMinorTotal,
    disposedProposals,
    approveUnchangedRate,
  }
}

/**
 * Recompute rollups for every agent with runs in the org, across each canonical
 * window the endpoint serves, and upsert the rows idempotently per
 * `(organizationId, agentId, windowStart)`. `windowEnd` is bucketed to
 * ROLLUP_BUCKET_MS so re-running the same interval re-stamps the SAME row rather
 * than duplicating it.
 */
export async function writeRollupsForOrg(em: EntityManager, scope: MetricScope): Promise<{ written: number }> {
  const windowEndMs = floorToBucket(Date.now())
  const windowEnd = new Date(windowEndMs)

  const runs = await em.find(
    AgentRun,
    { ...scope, deletedAt: null },
    { fields: ['agentId'], orderBy: { agentId: 'asc' } },
  )
  const agentIds = Array.from(new Set(runs.map((run) => run.agentId)))

  let written = 0
  for (const agentId of agentIds) {
    for (const windowKey of Object.keys(ROLLUP_WINDOW_MS)) {
      const windowStart = new Date(windowEndMs - ROLLUP_WINDOW_MS[windowKey])
      const metrics = await computeAgentMetrics(em, scope, { agentId, since: windowStart, until: windowEnd })

      const existing = await em.findOne(AgentMetricRollup, {
        organizationId: scope.organizationId,
        agentId,
        windowStart,
      })
      if (existing) {
        existing.windowEnd = windowEnd
        existing.computedAt = new Date()
        existing.metrics = metrics
        em.persist(existing)
      } else {
        em.persist(
          em.create(AgentMetricRollup, {
            tenantId: scope.tenantId,
            organizationId: scope.organizationId,
            agentId,
            windowStart,
            windowEnd,
            computedAt: new Date(),
            metrics,
          }),
        )
      }
      written += 1
    }
  }

  await em.flush()
  return { written }
}
