import type { QueuedJob, JobContext, WorkerMeta } from '@open-mercato/queue'
import { createQueue } from '@open-mercato/queue'
import { getRedisUrlOrThrow } from '@open-mercato/shared/lib/redis/connection'
import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities.js'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { emitSchedulerEvent } from '../events.js'
import { assertSchedulerSafeCommandAuthorized } from '../lib/scheduler-safe-commands.js'
import { buildScheduledCommandContext } from '../lib/commandContext.js'
import { buildQueueTargetPayload, buildSchedulerIdempotencyKey } from '../lib/queueTargetPayload.js'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  canDispatchScheduleQueueTarget,
  getSchedulerQueueRequiredFeatures,
  sanitizeSchedulerTargetPayload,
  validateSchedulerTargetPayload,
} from '../lib/safeQueueTargets'

const logger = createLogger('scheduler').child({ component: 'worker' })

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
type RbacServiceLike = {
  tenantHasFeature(
    tenantId: string | null | undefined,
    feature: string,
    opts?: { organizationId?: string | null },
  ): Promise<boolean>
  userHasAllFeatures(
    userId: string,
    required: readonly string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ): Promise<boolean>
}

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
  logger.debug('Processing job', {
    jobId: ctx.jobId,
    attemptNumber: ctx.attemptNumber,
  })
  
  // Defensive: handle both data and payload for BullMQ compatibility
  const payload = (job.payload || (job as unknown as { data?: ExecuteSchedulePayload }).data) as ExecuteSchedulePayload | undefined
  
  if (!payload || !payload.scheduleId) {
    logger.error('Invalid job payload: scheduleId missing', { jobId: ctx.jobId })
    throw new Error('scheduleId is required in job payload')
  }

  const { scheduleId } = payload

  const em = ctx.resolve<EntityManager>('em')
  const rbacService = ctx.resolve<RbacServiceLike>('rbacService')

  // Load fresh schedule from database
  const schedule = await em.findOne(ScheduledJob, { 
    id: scheduleId,
    deletedAt: null,
  })

  if (!schedule) {
    logger.info('Schedule not found or deleted', { scheduleId })
    return
  }

  // CRITICAL: Verify scope integrity - ensure payload scope matches database
  // This prevents scope tampering and ensures proper multi-tenant isolation
  if (payload.scopeType !== schedule.scopeType) {
    logger.error('Scope type mismatch for schedule', {
      scheduleId,
      payloadScope: payload.scopeType,
      dbScope: schedule.scopeType,
    })
    throw new Error('Schedule scope type mismatch - potential security issue')
  }

  if (payload.tenantId !== schedule.tenantId) {
    logger.error('Tenant ID mismatch for schedule', {
      scheduleId,
      payloadTenant: payload.tenantId,
      dbTenant: schedule.tenantId,
    })
    throw new Error('Schedule tenant ID mismatch - potential security issue')
  }

  if (payload.organizationId !== schedule.organizationId) {
    logger.error('Organization ID mismatch for schedule', {
      scheduleId,
      payloadOrg: payload.organizationId,
      dbOrg: schedule.organizationId,
    })
    throw new Error('Schedule organization ID mismatch - potential security issue')
  }

  // Check if schedule is still enabled
  if (!schedule.isEnabled) {
    logger.debug('Schedule is disabled', { scheduleId })
    await emitSchedulerEvent('scheduler.job.skipped', {
      id: schedule.id,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
      reason: 'Schedule is disabled',
    })
    return
  }

  // Emit started event
  await emitSchedulerEvent('scheduler.job.started', {
    id: schedule.id,
    tenantId: schedule.tenantId,
    organizationId: schedule.organizationId,
    scheduleName: schedule.name,
    attemptNumber: ctx.attemptNumber || 1,
  })

  // Check feature flag if required
  if (schedule.requireFeature) {
    const hasFeature = await rbacService.tenantHasFeature(
      schedule.tenantId,
      schedule.requireFeature,
      { organizationId: schedule.organizationId },
    )
    
    if (!hasFeature) {
      await emitSchedulerEvent('scheduler.job.skipped', {
        id: schedule.id,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
        reason: `Feature not enabled: ${schedule.requireFeature}`,
      })

      logger.debug('Schedule skipped: feature not enabled', { scheduleId, requireFeature: schedule.requireFeature })
      return
    }
  }

  // Enqueue target job or execute command
  if (schedule.targetType === 'queue' && schedule.targetQueue) {
    // Dispatch-time reauthorization (#5213): provenance is verified, never
    // trusted — module-authored rows must still be owned by their recorded
    // sourceModule and carry no acting-user stamp; API-authored rows may only
    // target workers that opted into scheduling.
    if (!canDispatchScheduleQueueTarget(schedule)) {
      logger.error('Refusing non-safe queue target for schedule', {
        scheduleId,
        targetQueue: schedule.targetQueue,
        sourceType: schedule.sourceType,
        sourceModule: schedule.sourceType === 'module' ? schedule.sourceModule : undefined,
      })
      await emitSchedulerEvent('scheduler.job.skipped', {
        id: schedule.id,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
        reason: `Queue is not an approved scheduler target: ${schedule.targetQueue}`,
      })
      return
    }

    // Re-validate the stored payload against the target's registered schema and
    // the tenant-level features the target requires (#5213, defense in depth).
    const payloadIssue = validateSchedulerTargetPayload(schedule.targetQueue, schedule.targetPayload)
    if (payloadIssue) {
      logger.error('Refusing schedule with invalid payload for queue target', {
        scheduleId,
        targetQueue: schedule.targetQueue,
        issue: payloadIssue,
      })
      await emitSchedulerEvent('scheduler.job.skipped', {
        id: schedule.id,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
        reason: `Invalid payload for scheduler queue ${schedule.targetQueue}`,
      })
      return
    }

    const requiredQueueFeatures = getSchedulerQueueRequiredFeatures(schedule.targetQueue)
    if (schedule.scopeType !== 'system' && requiredQueueFeatures.length > 0) {
      for (const feature of requiredQueueFeatures) {
        if (await rbacService.tenantHasFeature(schedule.tenantId, feature, { organizationId: schedule.organizationId })) continue
        logger.error('Refusing schedule whose tenant lacks a required feature of the queue target', {
          scheduleId,
          targetQueue: schedule.targetQueue,
          feature,
        })
        await emitSchedulerEvent('scheduler.job.skipped', {
          id: schedule.id,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
          reason: `Tenant lacks feature required by scheduler queue ${schedule.targetQueue}: ${feature}`,
        })
        return
      }
    }

    // Determine queue strategy from environment
    const queueStrategy = (process.env.QUEUE_STRATEGY || 'local') as 'local' | 'async'
    const targetQueue = createQueue(schedule.targetQueue, queueStrategy, {
      connection: { url: getRedisUrlOrThrow('QUEUE') },
    })

    let targetJobId: string | undefined
    try {
      // The execute-schedule job id is stable across BullMQ retries, so if
      // this worker crashes between enqueue and DB flush the retried attempt
      // reuses the same idempotency key and downstream workers can dedupe.
      const idempotencyKey = buildSchedulerIdempotencyKey(schedule.id, ctx.jobId ?? Date.now())

      // Rebuild tenant/org authority context and the trusted dispatch origin
      // server-side; author-supplied scope/envelope keys never survive (#5213).
      const sanitizedPayload = sanitizeSchedulerTargetPayload(schedule.targetPayload, schedule)
      targetJobId = await targetQueue.enqueue({
        ...buildQueueTargetPayload({
          targetPayload: sanitizedPayload,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
          idempotencyKey,
        }),
        _jobOrigin: 'scheduler' as const,
      })
    } finally {
      // Always close the queue instance to free Redis connections
      await targetQueue.close()
    }
    
    // Update schedule's last run time
    schedule.lastRunAt = new Date()
    await em.flush()

    await emitSchedulerEvent('scheduler.job.completed', {
      id: schedule.id,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
      queueJobId: targetJobId,
      queueName: schedule.targetQueue,
    })

    logger.debug('Successfully enqueued job', {
      scheduleId: schedule.id,
      targetQueue: schedule.targetQueue,
      queueJobId: targetJobId,
    })

  } else if (schedule.targetType === 'command' && schedule.targetCommand) {
    const commandBus = new CommandBus()
    const actorUserId = typeof schedule.createdByUserId === 'string' ? schedule.createdByUserId.trim() : ''
    await assertSchedulerSafeCommandAuthorized({
      commandId: schedule.targetCommand,
      actorUserId,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
      rbacService,
    })
    
    const commandInput = {
      ...((schedule.targetPayload as Record<string, unknown>) || {}),
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    }
    
    // Build the schedule-scoped command context after the allowlist/RBAC gate.
    const commandCtx = buildScheduledCommandContext(schedule, ctx as unknown as AppContainer)
    
    const commandResult = await commandBus.execute(schedule.targetCommand, {
      input: commandInput,
      ctx: commandCtx,
    })
    
    // Update schedule's last run time
    schedule.lastRunAt = new Date()
    await em.flush()
    
    await emitSchedulerEvent('scheduler.job.completed', {
      id: schedule.id,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
      commandId: schedule.targetCommand,
      commandResult: commandResult.result,
    })
    
    logger.debug('Successfully executed command', {
      scheduleId: schedule.id,
      commandId: schedule.targetCommand,
    })

  } else {
    throw new Error('Invalid target configuration')
  }
}
