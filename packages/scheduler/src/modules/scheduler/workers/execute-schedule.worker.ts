import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob, ScheduledJobRun } from '../data/entities'
import type { EventBus } from '@open-mercato/events'

// Worker metadata for auto-discovery
export const metadata: WorkerMeta = {
  queue: 'scheduler-execution',
  concurrency: 5, // Process up to 5 schedules concurrently
}

export type ExecuteSchedulePayload = {
  scheduleId: string
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Worker that executes scheduled jobs.
 * 
 * This worker is triggered by BullMQ repeatable jobs at the scheduled times.
 * It loads the fresh schedule configuration from the database, validates
 * conditions, and enqueues the target job.
 * 
 * BullMQ handles:
 * - Timing (exact cron/interval execution)
 * - Distributed locking (prevents duplicate execution)
 * - Retries (if worker fails)
 * 
 * This worker handles:
 * - Loading fresh schedule config
 * - Checking feature flags and conditions
 * - Enqueuing target job
 * - Logging execution history
 * - Updating next run time
 */
export default async function executeScheduleWorker(
  job: QueuedJob<ExecuteSchedulePayload>,
  jobCtx: JobContext,
  ctx: HandlerContext,
): Promise<void> {
  const { scheduleId } = job.payload

  const em = ctx.resolve('em') as EntityManager
  const eventBus = ctx.resolve('eventBus') as EventBus
  const queueService = ctx.resolve('queueService') as any
  const rbacService = ctx.resolve('rbacService') as any

  // Load fresh schedule from database
  const schedule = await em.findOne(ScheduledJob, { 
    id: scheduleId,
    deletedAt: null,
  })

  if (!schedule) {
    console.log(`[scheduler:worker] Schedule not found or deleted: ${scheduleId}`)
    return
  }

  // Check if schedule is still enabled
  if (!schedule.isEnabled) {
    console.log(`[scheduler:worker] Schedule is disabled: ${scheduleId}`)
    return
  }

  // Create execution run record  
  const run = new ScheduledJobRun()
  run.scheduledJobId = schedule.id
  run.tenantId = schedule.tenantId
  run.organizationId = schedule.organizationId
  run.status = 'running'
  run.triggerType = 'scheduled'
  run.startedAt = new Date()
  run.payload = job.payload as any
  
  await em.persistAndFlush(run)

  // Emit started event
  await eventBus.emit('scheduler.job.started', {
    scheduleId: schedule.id,
    runId: run.id,
    scheduleName: schedule.name,
    tenantId: schedule.tenantId,
    organizationId: schedule.organizationId,
  })

  try {
    // Check feature flag if required
    if (schedule.requireFeature) {
      const hasFeature = await rbacService.tenantHasFeature(
        schedule.tenantId,
        schedule.requireFeature
      )
      
      if (!hasFeature) {
        run.status = 'skipped'
        run.finishedAt = new Date()
        await em.flush()

        await eventBus.emit('scheduler.job.skipped', {
          scheduleId: schedule.id,
          runId: run.id,
          reason: `Feature not enabled: ${schedule.requireFeature}`,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
        })

        console.log(`[scheduler:worker] Schedule skipped - feature not enabled: ${schedule.requireFeature}`)
        return
      }
    }

    // Enqueue target job
    if (schedule.targetType === 'queue' && schedule.targetQueue) {
      const targetQueue = queueService.getQueue(schedule.targetQueue)
      
      const payload = {
        ...((schedule.targetPayload as any) || {}),
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
      }

      const targetJob = await targetQueue.add(schedule.targetQueue, payload)
      
      run.queueJobId = targetJob.id || null
      run.queueName = schedule.targetQueue
      run.status = 'completed'
      run.finishedAt = new Date()
      
      // Update schedule's last run time
      schedule.lastRunAt = new Date()
      
      await em.flush()

      await eventBus.emit('scheduler.job.completed', {
        scheduleId: schedule.id,
        runId: run.id,
        queueJobId: run.queueJobId,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
      })

      console.log(`[scheduler:worker] Successfully enqueued job`, {
        scheduleId: schedule.id,
        targetQueue: schedule.targetQueue,
        queueJobId: targetJob.id,
      })
    } else if (schedule.targetType === 'command' && schedule.targetCommand) {
      // TODO: Command execution not yet implemented
      throw new Error('Command execution not yet supported')
    } else {
      throw new Error('Invalid target configuration')
    }
  } catch (error: any) {
    run.status = 'failed'
    run.errorMessage = error.message
    run.errorStack = error.stack
    run.finishedAt = new Date()
    await em.flush()

    await eventBus.emit('scheduler.job.failed', {
      scheduleId: schedule.id,
      runId: run.id,
      error: error.message,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    })

    console.error(`[scheduler:worker] Failed to execute schedule`, {
      scheduleId: schedule.id,
      error: error.message,
    })

    // Re-throw to trigger BullMQ retry mechanism
    throw error
  }
}
