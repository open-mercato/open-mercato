import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE, type MetricRollupJobPayload } from '../lib/queue'
import { writeRollupsForOrg } from '../lib/metrics/metricRollupService'

/**
 * F2 metric rollups: precompute per-agent KPI windows into append-only rollup
 * rows on an interval so the metrics endpoint reads a stable window with a live
 * fallback (instead of a capped live scan). Enqueued per org by the scheduler.
 * Best-effort + idempotent (upsert per `(org, agent, windowStart)`): a failure
 * only logs — the endpoint's live fallback still serves fresh numbers.
 */
export const metadata: WorkerMeta = {
  queue: AGENT_ORCHESTRATOR_METRIC_ROLLUP_QUEUE,
  id: 'agent_orchestrator:metric-rollup',
  concurrency: 1,
}

export default async function handle(job: QueuedJob<MetricRollupJobPayload>, _ctx: JobContext): Promise<void> {
  const { scope } = job.payload
  if (!scope?.tenantId || !scope?.organizationId) return

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  try {
    await writeRollupsForOrg(em, scope)
  } catch (error) {
    // Best-effort tier: a rollup failure must not fail the job loudly. The
    // metrics endpoint falls back to live compute, so numbers stay correct.
    console.warn('[internal] agent_orchestrator: metric rollup failed', { scope, error })
  }
}
