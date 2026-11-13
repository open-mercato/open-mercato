import type { JobContext, JobHandler, QueuedJob } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveDeclaredDatabaseJobContext, validateDeclaredDatabaseBinding } from '@open-mercato/shared/lib/db/declarations'
import { isDatabaseRuntimeEnabled, runWithFreshDatabaseExecutionContext } from '@open-mercato/shared/lib/db/runtime'

type WorkerContainer = Awaited<ReturnType<typeof createRequestContainer>>
type SearchWorker<T> = (job: QueuedJob<T>, context: JobContext, container: Pick<WorkerContainer, 'resolve'>) => Promise<void>

export function createSearchWorkerHandler<T>(handler: SearchWorker<T>): JobHandler<T> {
  return async (job, context) => {
    const execute = async () => {
      const container = await createRequestContainer()
      try {
        await handler(job, context, { resolve: container.resolve.bind(container) })
      } finally {
        await container.dispose()
      }
    }
    if (!isDatabaseRuntimeEnabled()) return execute()
    const execution = await resolveDeclaredDatabaseJobContext({ queue: context.queueName, workerIds: [], payload: job.payload, metadata: job.metadata })
    if (execution.kind === 'tenant') {
      const valid = await runWithFreshDatabaseExecutionContext({ kind: 'identity', tenantId: execution.tenantId, source: 'identity', operation: context.queueName }, () => validateDeclaredDatabaseBinding({ context: execution }, { requireValidator: true }))
      if (!valid) throw new Error('[internal] Search job tenant binding is unavailable')
    }
    return runWithFreshDatabaseExecutionContext(execution, execute)
  }
}
