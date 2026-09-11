import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { writeRollupsForScope, type RollupScope } from '../lib/metrics/rollup-service'

const logger = createLogger('workflows').child({ component: 'definition-metric-rollup' })

// Worker metadata for auto-discovery.
// NOTE: `queue` MUST be a string literal (or locally-declared const) so the
// generator's AST-based extractor can resolve it when Node cannot import the
// .ts source file directly. Importing the name from another module breaks
// auto-discovery and silently drops the worker from `modules.generated.ts`.
const WORKFLOW_DEFINITION_METRIC_ROLLUP_QUEUE = 'workflow-definition-metric-rollup'

export const metadata: WorkerMeta = {
  queue: WORKFLOW_DEFINITION_METRIC_ROLLUP_QUEUE,
  // Database-heavy and idempotent, but a second concurrent pass over the same
  // scope would only race itself to write the identical row. One at a time
  // keeps the pass off the connection budget that real workflow execution needs.
  concurrency: 1,
  id: 'workflows:definition-metric-rollup',
}

/**
 * Scheduler tick payload, registered per organization in the module's
 * `setup.ts`. The scheduler spreads the configured `targetPayload` and then
 * adds `tenantId` / `organizationId` at the TOP level, so both shapes are read
 * and the nested one wins.
 */
export type DefinitionMetricRollupPayload = {
  scope?: { tenantId?: string | null; organizationId?: string | null }
  tenantId?: string | null
  organizationId?: string | null
}

function resolveScope(payload: DefinitionMetricRollupPayload | undefined): RollupScope | null {
  const tenantId = payload?.scope?.tenantId ?? payload?.tenantId
  const organizationId = payload?.scope?.organizationId ?? payload?.organizationId
  if (!tenantId || !organizationId) return null
  return { tenantId, organizationId }
}

/**
 * Recompute this organization's per-definition KPI rollups (spec §8.5).
 *
 * The pass is idempotent by construction — see `rollup-service` — so a retry
 * after a partial failure re-derives the same rows rather than double-counting.
 * A missing or half-filled scope is refused rather than widened: a rollup with
 * no organization would mix organizations' runs into one row.
 */
export default async function handle(
  job: QueuedJob<DefinitionMetricRollupPayload>,
  _ctx: JobContext,
): Promise<void> {
  const scope = resolveScope(job.payload)
  if (!scope) {
    logger.warn('Skipping metric rollup: job payload carries no tenant/organization scope')
    return
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const result = await writeRollupsForScope(em, scope)
  logger.info('Definition metric rollup pass complete', {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    workflowIds: result.workflowIds,
    written: result.written,
  })
}
