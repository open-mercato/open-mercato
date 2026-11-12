import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import * as workflowExecutor from '@open-mercato/core/modules/workflows/lib/workflow-executor'
import { startNdaReviewForMatter, type StartNdaReviewRun } from '../lib/startReview'

export const metadata = {
  event: 'legal_review.matter.created',
  persistent: true,
  id: 'legal_review:matter-created-start-review',
}

const logger = createLogger('legal_review').child({ component: 'matter-created-start-review' })

const matterCreatedPayloadSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  organizationId: z.string().uuid(),
})

type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

const startRunInProcess: StartNdaReviewRun = async ({ workflowId, correlationKey, initialContext, initiatedBy, scope }) => {
  const container = await createRequestContainer()
  const em = container.resolve<EntityManager>('em')
  const instance = await workflowExecutor.startWorkflow(em, {
    workflowId,
    correlationKey,
    initialContext,
    metadata: initiatedBy ? { initiatedBy } : undefined,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  setImmediate(() => {
    void (async () => {
      try {
        const runContainer: AwilixContainer = await createRequestContainer()
        const runEm = runContainer.resolve<EntityManager>('em')
        await workflowExecutor.executeWorkflow(runEm, runContainer, instance.id, initiatedBy ? { userId: initiatedBy } : undefined)
      } catch (error) {
        logger.error('NDA review run execution failed', { err: error, instanceId: instance.id })
        getTelemetryRuntime()?.reportError(error, { module: 'legal_review', code: 'legal_review.review_run_failed' })
      }
    })()
  })
  return { id: instance.id }
}

/**
 * Starts the NDA review workflow as soon as a legal matter is created, so the
 * reviewer agent's findings land on the document without a manual run.
 */
export default async function handleMatterCreated(payload: unknown, ctx: ResolverContext): Promise<void> {
  const parsed = matterCreatedPayloadSchema.safeParse(payload)
  if (!parsed.success) return
  const { id, tenantId, organizationId } = parsed.data
  try {
    const em = ctx.resolve<EntityManager>('em').fork()
    const result = await startNdaReviewForMatter(em, { tenantId, organizationId }, id, startRunInProcess)
    if (result.started) {
      logger.info('started NDA review run for legal matter', { matterId: id, instanceId: result.instanceId })
    }
  } catch (error) {
    logger.error('could not start NDA review run for legal matter', { err: error, matterId: id })
    getTelemetryRuntime()?.reportError(error, { module: 'legal_review', code: 'legal_review.review_start_failed' })
  }
}
