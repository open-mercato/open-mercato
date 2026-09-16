import type { ProgressService } from '../../progress/lib/progressService'
import type { SyncRunService } from './sync-run-service'
import { getSyncQueue } from './queue'
import { DATA_SYNC_EXPORT_QUEUE, DATA_SYNC_IMPORT_QUEUE } from './queue-policy'
import { resolveAdapterForIntegration } from './adapter-registry'
import { defaultBatchSizeFor } from './default-batch-size'

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
  /**
   * Page size for this run. Omit to take the adapter's declared default for the
   * entity type, falling back to core's own — see `lib/default-batch-size.ts`.
   */
  batchSize?: number
  parameters?: Record<string, unknown> | null
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
      parameters: input.parameters ?? null,
      progressJobId: progressJob?.id ?? null,
    },
    {
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
  )

  const queueName = input.direction === 'import' ? DATA_SYNC_IMPORT_QUEUE : DATA_SYNC_EXPORT_QUEUE
  const queue = getSyncQueue(queueName)
  await queue.enqueue({
    runId: run.id,
    // Resolved HERE rather than in each caller because every start path funnels
    // through this helper — the run route, Retry, the scheduled worker, and any
    // provider route that enqueues a run of its own. A caller that names no page
    // size gets the adapter's, and a future one cannot forget to ask.
    batchSize: input.batchSize ?? defaultBatchSizeFor(
      resolveAdapterForIntegration(input.integrationId),
      input.entityType,
    ),
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
