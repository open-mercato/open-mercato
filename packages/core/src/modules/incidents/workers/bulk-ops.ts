import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import {
  INCIDENT_BULK_OPS_QUEUE,
  executeIncidentBulkOpsWithProgress,
  type IncidentBulkOpsJobPayload,
} from '../lib/bulkOps'

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export const metadata: WorkerMeta = {
  queue: INCIDENT_BULK_OPS_QUEUE,
  id: 'incidents-bulk-ops',
  concurrency: 1,
}

export default async function handle(
  job: QueuedJob<IncidentBulkOpsJobPayload>,
  _ctx: HandlerContext,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    await executeIncidentBulkOpsWithProgress({
      container,
      progressJobId: job.payload.progressJobId,
      action: job.payload.action,
      ids: job.payload.ids,
      scope: job.payload.scope,
    })
  } catch (error) {
    const progressService = container.resolve('progressService') as ProgressService
    await progressService.failJob(
      job.payload.progressJobId,
      {
        errorMessage: error instanceof Error ? error.message : 'Bulk incident operation failed',
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
