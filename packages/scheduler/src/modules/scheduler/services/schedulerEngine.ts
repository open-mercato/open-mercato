import type { EntityManager } from '@mikro-orm/core'
import type { EventBus } from '@open-mercato/events'
import type { Queue } from '@open-mercato/queue'
import { ScheduledJob, ScheduledJobRun } from '../data/entities.js'
import { recalculateNextRun } from './nextRunCalculator.js'
import { LocalLockStrategy } from '../lib/strategies/local.js'
import { AsyncLockStrategy } from '../lib/strategies/async.js'

export interface SchedulerEngineConfig {
  strategy: 'local' | 'async'
  pollIntervalMs?: number
  lockTimeoutMs?: number
  redisUrl?: string
}

/**
 * @deprecated Use BullMQ repeatable jobs instead (BullMQSchedulerService + execute-schedule.worker)
 * 
 * This polling-based engine is kept for backward compatibility but is no longer recommended.
 * The new architecture uses BullMQ's built-in job schedulers which provide:
 * - Exact timing (no polling delay)
 * - Built-in distributed locking
 * - Better scalability
 * - Simpler codebase
 * 
 * See: https://docs.bullmq.io/guide/job-schedulers
 */
export class SchedulerEngine {
  private isRunning = false
  private pollTimer?: NodeJS.Timeout
  private strategy: 'local' | 'async'
  private pollIntervalMs: number
  private lockTimeoutMs: number
  private lockStrategy: LocalLockStrategy | AsyncLockStrategy

  constructor(
    private em: () => EntityManager,
    private eventBus: EventBus,
    private queueFactory: (queueName: string) => Queue<any>,
    private rbacService: any,
    config: SchedulerEngineConfig
  ) {
    this.strategy = config.strategy
    this.pollIntervalMs = config.pollIntervalMs ?? 30000
    this.lockTimeoutMs = config.lockTimeoutMs ?? 60000

    // Initialize lock strategy
    if (this.strategy === 'local') {
      this.lockStrategy = new LocalLockStrategy(this.em)
    } else {
      this.lockStrategy = new AsyncLockStrategy(config.redisUrl)
    }
  }

  async start() {
    if (this.isRunning) return
    this.isRunning = true
    console.log('[scheduler] Engine started', { strategy: this.strategy })
    await this.tick()
  }

  async stop() {
    this.isRunning = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
    console.log('[scheduler] Engine stopped')
  }

  private async tick() {
    try {
      await this.processDueSchedules()
    } catch (error) {
      console.error('[scheduler] Tick error:', error)
    }

    if (this.isRunning) {
      this.pollTimer = setTimeout(() => this.tick(), this.pollIntervalMs)
    }
  }

  private async processDueSchedules() {
    const em = this.em().fork()
    const now = new Date()

    // Find due schedules
    const dueSchedules = await em.find(ScheduledJob, {
      isEnabled: true,
      deletedAt: null,
      nextRunAt: { $lte: now },
    })

    console.log(`[scheduler] Found ${dueSchedules.length} due schedules`)

    for (const schedule of dueSchedules) {
      await this.executeSchedule(schedule, em)
    }
  }

  private async executeSchedule(schedule: ScheduledJob, em: EntityManager) {
    const lockKey = `schedule:${schedule.id}`

    // Try to acquire lock
    const lockAcquired = await this.lockStrategy.tryLock(lockKey, this.lockTimeoutMs)
    if (!lockAcquired) {
      console.log('[scheduler] Lock not acquired, skipping', { scheduleId: schedule.id })
      return
    }

    try {
      // Check feature flag if required
      if (schedule.requireFeature && schedule.organizationId) {
        const hasFeature = await this.checkFeature(schedule.requireFeature, schedule.organizationId)
        if (!hasFeature) {
          await this.logSkippedRun(schedule, 'Feature not enabled', em)
          return
        }
      }

      // Create run record
      const run = em.create(ScheduledJobRun, {
        scheduledJobId: schedule.id,
        organizationId: schedule.organizationId || null,
        tenantId: schedule.tenantId || null,
        triggerType: 'scheduled',
        status: 'running',
        payload: schedule.targetPayload,
        startedAt: new Date(),
        createdAt: new Date(),
      })
      em.persist(run)
      await em.flush()

      // Emit started event
      await this.eventBus.emit('scheduler.job.started', {
        scheduleId: schedule.id,
        runId: run.id,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
      })

      try {
        // Enqueue job
        if (schedule.targetType === 'queue' && schedule.targetQueue) {
          const queue = this.queueFactory(schedule.targetQueue)
          const jobId = await queue.enqueue({
            ...(schedule.targetPayload ?? {}),
            tenantId: schedule.tenantId,
            organizationId: schedule.organizationId,
          })

          run.queueJobId = jobId
          run.queueName = schedule.targetQueue
        }

        // Mark as completed
        run.status = 'completed'
        run.finishedAt = new Date()
        run.durationMs = run.finishedAt.getTime() - run.startedAt.getTime()

        // Update schedule
        schedule.lastRunAt = new Date()
        schedule.nextRunAt = recalculateNextRun(
          schedule.scheduleType,
          schedule.scheduleValue,
          schedule.timezone
        )

        await em.flush()

        // Emit completed event
        await this.eventBus.emit('scheduler.job.completed', {
          scheduleId: schedule.id,
          runId: run.id,
          queueJobId: run.queueJobId,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
        })

        console.log('[scheduler] Schedule executed successfully', {
          scheduleId: schedule.id,
          runId: run.id,
          nextRunAt: schedule.nextRunAt,
        })
      } catch (error) {
        // Log error in run record
        run.status = 'failed'
        run.errorMessage = error instanceof Error ? error.message : 'Unknown error'
        run.errorStack = error instanceof Error ? error.stack : undefined
        run.finishedAt = new Date()
        run.durationMs = run.finishedAt.getTime() - run.startedAt.getTime()
        await em.flush()

        // Still update next run time (keep retrying)
        schedule.lastRunAt = new Date()
        schedule.nextRunAt = recalculateNextRun(
          schedule.scheduleType,
          schedule.scheduleValue,
          schedule.timezone
        )
        await em.flush()

        // Emit failed event
        await this.eventBus.emit('scheduler.job.failed', {
          scheduleId: schedule.id,
          runId: run.id,
          error: error instanceof Error ? error.message : 'Unknown error',
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
        })

        console.error('[scheduler] Schedule execution failed', {
          scheduleId: schedule.id,
          error,
        })
      }
    } finally {
      await this.lockStrategy.unlock(lockKey)
    }
  }

  private async logSkippedRun(
    schedule: ScheduledJob,
    reason: string,
    em: EntityManager
  ) {
    const run = em.create(ScheduledJobRun, {
      scheduledJobId: schedule.id,
      organizationId: schedule.organizationId || null,
      tenantId: schedule.tenantId || null,
      triggerType: 'scheduled',
      status: 'skipped',
      errorMessage: reason,
      startedAt: new Date(),
      finishedAt: new Date(),
      createdAt: new Date(),
    })
    em.persist(run)
    await em.flush()

    // Emit skipped event
    await this.eventBus.emit('scheduler.job.skipped', {
      scheduleId: schedule.id,
      runId: run.id,
      reason,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    })

    console.log('[scheduler] Schedule skipped', {
      scheduleId: schedule.id,
      reason,
    })
  }

  private async checkFeature(
    feature: string,
    organizationId: string
  ): Promise<boolean> {
    try {
      // This will be injected properly via DI
      if (!this.rbacService || !this.rbacService.organizationHasFeature) {
        return true // If service not available, allow execution
      }
      return await this.rbacService.organizationHasFeature(organizationId, feature)
    } catch (error) {
      console.error('[scheduler] Failed to check feature flag:', error)
      return true // On error, allow execution
    }
  }
}
