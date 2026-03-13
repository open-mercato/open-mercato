import type { ProgressService } from '../../progress/lib/progressService'
import type { SyncRunService } from './sync-run-service'
import { getSyncQueue } from './queue'

export type DataSyncStartScope = {
  organizationId: string
  tenantId: string
  userId?: string | null
}

export type StartDataSyncRunInput = {
  integrationId: string
  entityType: string
  direction: 'import' | 'export'
  cursor?: string | null
  triggeredBy?: string | null
  batchSize?: number
  createProgressJob?: boolean
  progressJob?: {
    jobType?: string
    name?: string
    description?: string
    cancellable?: boolean
    meta?: Record<string, unknown>
  }
}

export async function startDataSyncRun(params: {
  syncRunService: SyncRunService
  progressService: ProgressService
  scope: DataSyncStartScope
  input: StartDataSyncRunInput
}) {
  const { syncRunService, progressService, scope, input } = params
  const createProgressJob = input.createProgressJob !== false

  const progressJob = createProgressJob
    ? await progressService.createJob(
      {
        jobType: input.progressJob?.jobType ?? `data_sync:${input.direction}`,
        name: input.progressJob?.name ?? `Data sync ${input.integrationId} — ${input.entityType}`,
        description: input.progressJob?.description ?? `${input.entityType} ${input.direction}`,
        cancellable: input.progressJob?.cancellable ?? true,
        meta: {
          integrationId: input.integrationId,
          entityType: input.entityType,
          direction: input.direction,
          ...(input.progressJob?.meta ?? {}),
        },
      },
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: scope.userId,
      },
    )
    : null

  const run = await syncRunService.createRun(
    {
      integrationId: input.integrationId,
      entityType: input.entityType,
      direction: input.direction,
      cursor: input.cursor ?? null,
      triggeredBy: input.triggeredBy ?? scope.userId ?? null,
      progressJobId: progressJob?.id ?? null,
    },
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
  )

  const queueName = input.direction === 'import' ? 'data-sync-import' : 'data-sync-export'
  const queue = getSyncQueue(queueName)
  await queue.enqueue({
    runId: run.id,
    batchSize: input.batchSize ?? 100,
    scope: {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      userId: scope.userId ?? null,
    },
  })

  return {
    run,
    progressJob,
  }
}
