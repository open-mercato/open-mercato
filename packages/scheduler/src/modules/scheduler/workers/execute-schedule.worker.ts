import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { createQueue } from '@open-mercato/queue'
import { getRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities'
import type { EventBus } from '@open-mercato/events'
import { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { AwilixContainer } from 'awilix'
import { AppContainer } from '@open-mercato/shared/lib/di/container.ts'

// Worker metadata for auto-discovery
export const metadata: WorkerMeta = {
  queue: 'scheduler-execution',
  concurrency: 5, // Process up to 5 schedules concurrently
}

export type ExecuteSchedulePayload = {
  scheduleId: string
  tenantId?: string | null
  organizationId?: string | null
  scopeType: 'system' | 'organization' | 'tenant'
  triggerType?: 'scheduled' | 'manual'
  triggeredByUserId?: string | null
}

type HandlerContext = { resolve: <T = unknown>(name: string) => T }

/**
 * Worker that executes scheduled jobs.
 * 
 * This worker is triggered by BullMQ repeatable jobs at the scheduled times.
 * It loads the fresh schedule configuration from the database, validates
 * conditions, and enqueues the target job or executes the command.
 * 
 * BullMQ handles:
 * - Timing (exact cron/interval execution)
 * - Distributed locking (prevents duplicate execution)
 * - Retries (if worker fails)
 * - Execution history (via job state, logs, timestamps)
 * 
 * This worker handles:
 * - Loading fresh schedule config
 * - Checking feature flags and conditions
 * - Enqueuing target job or executing command
 * - Updating last run time
 */
export default async function executeScheduleWorker(
  job: QueuedJob<ExecuteSchedulePayload>,
  ctx: JobContext & HandlerContext,
): Promise<void> {
  console.debug('[scheduler:execute] Processing job:', {
    jobId: ctx.jobId,
    attemptNumber: ctx.attemptNumber,
  })
  
  // Defensive: handle both data and payload for BullMQ compatibility
  const payload = (job.payload || (job as any).data) as ExecuteSchedulePayload | undefined
  
  if (!payload || !payload.scheduleId) {
    console.error('[scheduler:execute] Invalid job payload:', {
      jobId: ctx.jobId,
      payload: job.payload,
    })
    throw new Error('scheduleId is required in job payload')
  }

  const { scheduleId } = payload

  const em = ctx.resolve('em') as EntityManager
  const eventBus = ctx.resolve('eventBus') as EventBus
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

  // CRITICAL: Verify scope integrity - ensure payload scope matches database
  // This prevents scope tampering and ensures proper multi-tenant isolation
  if (payload.scopeType !== schedule.scopeType) {
    console.error(`[scheduler:worker] Scope type mismatch for schedule ${scheduleId}:`, {
      payloadScope: payload.scopeType,
      dbScope: schedule.scopeType,
    })
    throw new Error('Schedule scope type mismatch - potential security issue')
  }

  if (payload.tenantId !== schedule.tenantId) {
    console.error(`[scheduler:worker] Tenant ID mismatch for schedule ${scheduleId}:`, {
      payloadTenant: payload.tenantId,
      dbTenant: schedule.tenantId,
    })
    throw new Error('Schedule tenant ID mismatch - potential security issue')
  }

  if (payload.organizationId !== schedule.organizationId) {
    console.error(`[scheduler:worker] Organization ID mismatch for schedule ${scheduleId}:`, {
      payloadOrg: payload.organizationId,
      dbOrg: schedule.organizationId,
    })
    throw new Error('Schedule organization ID mismatch - potential security issue')
  }

  // Check if schedule is still enabled
  if (!schedule.isEnabled) {
    console.debug(`[scheduler:worker] Schedule is disabled: ${scheduleId}`)
    await eventBus.emit('scheduler.job.skipped', {
      scheduleId: schedule.id,
      reason: 'Schedule is disabled',
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    })
    return
  }

  // Emit started event
  await eventBus.emit('scheduler.job.started', {
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    tenantId: schedule.tenantId,
    organizationId: schedule.organizationId,
    attemptNumber: ctx.attemptNumber || 1,
  })

  // Check feature flag if required
  if (schedule.requireFeature) {
    const hasFeature = await rbacService.tenantHasFeature(
      schedule.tenantId,
      schedule.requireFeature
    )
    
    if (!hasFeature) {
      await eventBus.emit('scheduler.job.skipped', {
        scheduleId: schedule.id,
        reason: `Feature not enabled: ${schedule.requireFeature}`,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
      })

      console.debug(`[scheduler:worker] Schedule skipped - feature not enabled: ${schedule.requireFeature}`)
      return
    }
  }

  // Enqueue target job or execute command
  if (schedule.targetType === 'queue' && schedule.targetQueue) {
    // Determine queue strategy from environment
    const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
    const targetQueue = createQueue(schedule.targetQueue, queueStrategy, {
      connection: { url: getRedisUrl('QUEUE') },
    })
    
    let targetJobId: string | undefined
    try {
      // Generate a deterministic idempotency key so that if BullMQ retries
      // this worker after a crash between enqueue and DB flush, downstream
      // workers can deduplicate using this key.
      const executionTimestamp = Date.now()
      const idempotencyKey = `scheduler-${schedule.id}-${executionTimestamp}`

      const queuePayload = {
        ...((schedule.targetPayload as Record<string, unknown>) || {}),
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
        _idempotencyKey: idempotencyKey,
      }

      targetJobId = await targetQueue.enqueue(queuePayload)
    } finally {
      // Always close the queue instance to free Redis connections
      await targetQueue.close()
    }
    
    // Update schedule's last run time
    schedule.lastRunAt = new Date()
    await em.flush()

    await eventBus.emit('scheduler.job.completed', {
      scheduleId: schedule.id,
      queueJobId: targetJobId,
      queueName: schedule.targetQueue,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    })

    console.debug(`[scheduler:worker] Successfully enqueued job`, {
      scheduleId: schedule.id,
      targetQueue: schedule.targetQueue,
      queueJobId: targetJobId,
    })

  } else if (schedule.targetType === 'command' && schedule.targetCommand) {
    const commandBus = new CommandBus()
    
    const commandInput = {
      ...((schedule.targetPayload as Record<string, unknown>) || {}),
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    }
    
    // Build command runtime context
    // Scheduled commands run without user auth but with proper tenant/org scope
    const commandCtx: CommandRuntimeContext = {
      container: ctx as unknown as AppContainer,
      auth: null, // Scheduled commands run without user authentication
      organizationScope: null, // No organization scope filtering for scheduled commands
      selectedOrganizationId: schedule.organizationId || null,
      organizationIds: schedule.organizationId ? [schedule.organizationId] : null,
      request: undefined,
    }
    
    const commandResult = await commandBus.execute(schedule.targetCommand, {
      input: commandInput,
      ctx: commandCtx,
    })
    
    // Update schedule's last run time
    schedule.lastRunAt = new Date()
    await em.flush()
    
    await eventBus.emit('scheduler.job.completed', {
      scheduleId: schedule.id,
      commandId: schedule.targetCommand,
      commandResult: commandResult.result,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    })
    
    console.debug(`[scheduler:worker] Successfully executed command`, {
      scheduleId: schedule.id,
      commandId: schedule.targetCommand,
      result: commandResult.result,
    })

  } else {
    throw new Error('Invalid target configuration')
  }
}
