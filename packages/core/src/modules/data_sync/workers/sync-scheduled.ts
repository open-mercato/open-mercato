import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { IntegrationStateService } from '../../integrations/lib/state-service'
import type { ProgressService } from '../../progress/lib/progressService'
import type { SyncRunService } from '../lib/sync-run-service'
import { SyncSchedule } from '../data/entities'
import { startDataSyncRun } from '../lib/start-run'
import { resolveAdapterForIntegration, resolveStartCursor } from '../lib/start-cursor'
import { normalizeRunParameters } from '../lib/run-parameters'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('data_sync').child({ component: 'sync-scheduled' })

type ScheduledSyncPayload = {
  scheduleId: string
  scope: {
    organizationId: string
    tenantId: string
  }
}

export const metadata: WorkerMeta = {
  queue: 'data-sync-scheduled',
  id: 'data-sync:scheduled',
  concurrency: 3,
}

type HandlerContext = JobContext & {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(job: QueuedJob<ScheduledSyncPayload>, ctx: HandlerContext): Promise<void> {
  const em = ctx.resolve<EntityManager>('em')
  const syncRunService = ctx.resolve<SyncRunService>('dataSyncRunService')
  const progressService = ctx.resolve<ProgressService>('progressService')
  const integrationStateService = ctx.resolve<IntegrationStateService>('integrationStateService')

  const schedule = await findOneWithDecryption(
    em,
    SyncSchedule,
    {
      id: job.payload.scheduleId,
      organizationId: job.payload.scope.organizationId,
      tenantId: job.payload.scope.tenantId,
      deletedAt: null,
    },
    undefined,
    job.payload.scope,
  )

  if (!schedule || !schedule.isEnabled) {
    return
  }

  const integrationEnabled = await integrationStateService.isEnabled(schedule.integrationId, job.payload.scope)
  if (!integrationEnabled) {
    return
  }

  const overlap = await syncRunService.findRunningOverlap(
    schedule.integrationId,
    schedule.entityType,
    schedule.direction,
    job.payload.scope,
  )
  if (overlap) {
    return
  }

  const adapter = resolveAdapterForIntegration(schedule.integrationId)

  const cursor = schedule.fullSync
    ? null
    : await resolveStartCursor({
        syncRunService,
        adapter,
        integrationId: schedule.integrationId,
        entityType: schedule.entityType,
        direction: schedule.direction,
        scope: job.payload.scope,
      })

  // A schedule carries no parameter form, but the adapter's declared defaults
  // still apply: normalizing an empty input materializes exactly those, so a
  // scheduled run reaches the adapter with the same set a manual run would
  // rather than an empty object. A declaration whose own default is invalid
  // stops the run instead of handing over a half-applied set.
  const normalizedParameters = normalizeRunParameters(
    adapter?.runParameters,
    schedule.direction,
    null,
    schedule.entityType,
  )
  if (!normalizedParameters.ok) {
    logger.error('Scheduled run skipped: adapter declares invalid run parameter defaults', {
      scheduleId: schedule.id,
      integrationId: schedule.integrationId,
      entityType: schedule.entityType,
      keys: normalizedParameters.errors.map((error) => error.key),
    })
    return
  }
  const parameters = Object.keys(normalizedParameters.values).length > 0
    ? normalizedParameters.values
    : null

  schedule.lastRunAt = new Date()
  await em.flush()

  await startDataSyncRun({
    syncRunService,
    progressService,
    scope: job.payload.scope,
    input: {
      integrationId: schedule.integrationId,
      entityType: schedule.entityType,
      direction: schedule.direction,
      cursor,
      triggeredBy: 'scheduler',
      parameters,
    },
  })
}
