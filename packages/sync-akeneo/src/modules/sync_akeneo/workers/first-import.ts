import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '@open-mercato/core/modules/progress/lib/progressService'
import {
  AKENEO_FIRST_IMPORT_QUEUE,
  runAkeneoFirstImportSequence,
  type AkeneoFirstImportJobPayload,
} from '../lib/first-import'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: AKENEO_FIRST_IMPORT_QUEUE,
  id: 'sync-akeneo:first-import',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<AkeneoFirstImportJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await runAkeneoFirstImportSequence({
      container,
      progressJobId: job.payload.progressJobId,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage: error instanceof Error ? error.message : 'Failed to run the first full Akeneo import',
      },
      {
        tenantId: job.payload.scope.tenantId,
        organizationId: job.payload.scope.organizationId,
        userId: job.payload.scope.userId,
      },
    )
    throw error
  }
}
