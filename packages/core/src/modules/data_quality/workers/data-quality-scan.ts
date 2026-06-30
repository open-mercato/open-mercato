import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { ProgressService } from '../../progress/lib/progressService'
import type { EntityManager } from '@mikro-orm/postgresql'
import { executeScanRun } from '../lib/scanRunner'

export const DATA_QUALITY_SCAN_QUEUE = 'data-quality-scan'

export type DataQualityScanJobPayload = {
  scanRunId: string
  tenantId: string
  organizationId: string
  userId?: string | null
  progressJobId?: string | null
}

export const metadata: WorkerMeta = {
  queue: DATA_QUALITY_SCAN_QUEUE,
  id: 'data_quality:scan',
  concurrency: 2,
}

export default async function handle(
  job: QueuedJob<DataQualityScanJobPayload>,
): Promise<void> {
  const container = await createRequestContainer()

  try {
    const em = container.resolve<EntityManager>('em')
    const progressService = container.resolve('progressService') as ProgressService

    await executeScanRun(job.payload.scanRunId, { em, progressService }, {
      tenantId: job.payload.tenantId,
      organizationId: job.payload.organizationId,
      userId: job.payload.userId,
    })
  } catch (error) {
    if (job.payload.progressJobId) {
      try {
        const progressService = container.resolve('progressService') as ProgressService
        await progressService.failJob(
          job.payload.progressJobId,
          {
            errorMessage: error instanceof Error ? error.message : 'Data quality scan failed',
          },
          {
            tenantId: job.payload.tenantId,
            organizationId: job.payload.organizationId,
            userId: job.payload.userId,
          },
        )
      } catch {
        // Best-effort progress failure marking
      }
    }
    throw error
  }
}
