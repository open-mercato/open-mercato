import { z } from 'zod'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { ProgressService } from '../../progress/lib/progressService'
import type { DataSyncProgressJobDescription } from './adapter'
import { resolveAdapterForIntegration } from './adapter-registry'
import type { SyncRunService } from './sync-run-service'
import { getSyncQueue } from './queue'
import { DATA_SYNC_EXPORT_QUEUE, DATA_SYNC_IMPORT_QUEUE } from './queue-policy'

const logger = createLogger('data_sync').child({ component: 'start-run' })

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

const progressJobDescriptionSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

/**
 * The adapter's answer to `describeProgressJob`, or nothing. A hook that throws
 * or answers with the wrong shape is dropped whole rather than failing the start:
 * the run matters more than how its progress job reads.
 */
function resolveAdapterProgressJobDescription(input: StartDataSyncRunInput): DataSyncProgressJobDescription {
  const adapter = resolveAdapterForIntegration(input.integrationId)
  if (typeof adapter?.describeProgressJob !== 'function') return {}
  const attributes = {
    integrationId: input.integrationId,
    entityType: input.entityType,
    direction: input.direction,
  }
  let declared: unknown
  try {
    declared = adapter.describeProgressJob({ entityType: input.entityType, direction: input.direction })
  } catch (error) {
    logger.warn('Data sync adapter failed to describe its progress job; using the defaults', { ...attributes, err: error })
    getTelemetryRuntime()?.reportError(error, {
      module: 'data_sync',
      code: 'data_sync.progress_job_description_failed',
      attributes,
    })
    return {}
  }
  if (declared === undefined) return {}
  const parsed = progressJobDescriptionSchema.safeParse(declared)
  if (!parsed.success) {
    logger.warn('Data sync adapter described its progress job with an invalid shape; using the defaults', {
      ...attributes,
      issues: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    })
    return {}
  }
  return parsed.data
}

export async function startDataSyncRun(params: {
  syncRunService: SyncRunService
  progressService: ProgressService
  scope: DataSyncStartScope
  input: StartDataSyncRunInput
}) {
  const { syncRunService, progressService, scope, input } = params
  const createProgressJob = input.createProgressJob !== false

  const described = createProgressJob ? resolveAdapterProgressJobDescription(input) : {}
  const progressJob = createProgressJob
    ? await progressService.createJob(
      {
        jobType: input.progressJob?.jobType ?? `data_sync:${input.direction}`,
        name: input.progressJob?.name ?? described.name ?? `Data sync ${input.integrationId} — ${input.entityType}`,
        description: input.progressJob?.description ?? described.description ?? `${input.entityType} ${input.direction}`,
        cancellable: input.progressJob?.cancellable ?? true,
        meta: {
          integrationId: input.integrationId,
          entityType: input.entityType,
          direction: input.direction,
          ...(described.meta ?? {}),
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
