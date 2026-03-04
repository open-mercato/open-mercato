import type { JobContext, QueuedJob, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { SyncRunService } from '../lib/sync-run-service'
import { SyncSchedule } from '../data/entities'

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

  const schedule = await em.findOne(SyncSchedule, {
    id: job.payload.scheduleId,
    organizationId: job.payload.scope.organizationId,
    tenantId: job.payload.scope.tenantId,
    deletedAt: null,
  })

  if (!schedule || !schedule.isEnabled) {
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

  const cursor = schedule.fullSync
    ? null
    : await syncRunService.resolveCursor(
        schedule.integrationId,
        schedule.entityType,
        schedule.direction,
        job.payload.scope,
      )

  const run = await syncRunService.createRun({
    integrationId: schedule.integrationId,
    entityType: schedule.entityType,
    direction: schedule.direction,
    cursor,
    triggeredBy: 'scheduler',
  }, job.payload.scope)

  schedule.lastRunAt = new Date()
  await em.flush()

  const queueName = schedule.direction === 'import' ? 'data-sync-import' : 'data-sync-export'
  const queue = ctx.resolve<{ add: (name: string, payload: unknown) => Promise<void> }>(queueName)
  await queue.add(`sync-${run.id}`, {
    runId: run.id,
    batchSize: 100,
    scope: job.payload.scope,
  })
}
