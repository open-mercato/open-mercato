import type { EntityManager } from '@mikro-orm/core'
import type { Queue } from '@open-mercato/queue'
import type { EventBus } from '@open-mercato/events'
import { ScheduledJob, ScheduledJobRun } from '../data/entities'
import { recalculateNextRun } from './nextRunCalculator'

/**
 * Local scheduler service for development without Redis.
 * 
 * This is a simplified polling-based scheduler that works with QUEUE_STRATEGY=local.
 * It's intended for local development only - use BullMQ for production.
 * 
 * How it works:
 * 1. Polls database every 30s for due schedules
 * 2. Uses PostgreSQL advisory locks to prevent duplicate execution
 * 3. Enqueues jobs directly to target queues
 * 4. Updates next run time
 * 5. Logs execution history
 * 6. Emits events (same as BullMQ worker)
 * 
 * Benefits vs BullMQ:
 * - No Redis required
 * - Simpler setup for local dev
 * 
 * Drawbacks vs BullMQ:
 * - Polling delay (up to 30s)
 * - Higher database load
 * - Only works with single instance
 * - No distributed locking
 */
export class LocalSchedulerService {
  private isRunning = false
  private pollTimer?: NodeJS.Timeout
  private pollIntervalMs: number

  constructor(
    private em: () => EntityManager,
    private queueFactory: (name: string) => Queue<any>,
    private eventBus: EventBus,
    private rbacService: any,
    config?: { pollIntervalMs?: number }
  ) {
    this.pollIntervalMs = config?.pollIntervalMs ?? 30000
  }

  /**
   * Start the local scheduler engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[scheduler:local] Already running')
      return
    }

    this.isRunning = true
    console.log('[scheduler:local] Started', {
      pollInterval: `${this.pollIntervalMs}ms`,
    })

    // Start polling
    await this.tick()
  }

  /**
   * Stop the local scheduler engine
   */
  async stop(): Promise<void> {
    this.isRunning = false
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = undefined
    }
    console.log('[scheduler:local] Stopped')
  }

  /**
   * Poll for due schedules and execute them
   */
  private async tick(): Promise<void> {
    try {
      await this.processDueSchedules()
    } catch (error: any) {
      console.error('[scheduler:local] Tick error:', error.message)
    }

    if (this.isRunning) {
      this.pollTimer = setTimeout(() => this.tick(), this.pollIntervalMs)
    }
  }

  /**
   * Find and process all due schedules
   */
  private async processDueSchedules(): Promise<void> {
    const em = this.em().fork()
    const now = new Date()

    // Find due schedules
    const dueSchedules = await em.find(ScheduledJob, {
      isEnabled: true,
      deletedAt: null,
      nextRunAt: { $lte: now },
    })

    if (dueSchedules.length === 0) {
      return
    }

    console.log(`[scheduler:local] Found ${dueSchedules.length} due schedule(s)`)

    // Process each schedule
    for (const schedule of dueSchedules) {
      await this.executeSchedule(schedule, em)
    }
  }

  /**
   * Execute a single schedule
   */
  private async executeSchedule(schedule: ScheduledJob, em: EntityManager): Promise<void> {
    // Use PostgreSQL advisory lock to prevent duplicate execution
    const lockId = this.hashStringToNumber(schedule.id)
    
    try {
      // Try to acquire advisory lock (non-blocking)
      const lockResult = await em.getConnection().execute(
        'SELECT pg_try_advisory_lock(?) as locked',
        [lockId]
      )

      const locked = lockResult[0]?.locked
      if (!locked) {
        console.log(`[scheduler:local] Lock not acquired, skipping: ${schedule.name}`)
        return
      }

      // Execute the schedule
      await this.doExecute(schedule, em)

      // Release lock
      await em.getConnection().execute('SELECT pg_advisory_unlock(?)', [lockId])
    } catch (error: any) {
      console.error(`[scheduler:local] Failed to execute schedule: ${schedule.name}`, error)
      
      // Make sure we release the lock even on error
      try {
        await em.getConnection().execute('SELECT pg_advisory_unlock(?)', [lockId])
      } catch {
        // Ignore unlock errors
      }
    }
  }

  /**
   * Actually execute the schedule (enqueue job)
   * Mirrors the BullMQ worker behavior: creates run record, emits events, logs history
   */
  private async doExecute(schedule: ScheduledJob, em: EntityManager): Promise<void> {
    console.log(`[scheduler:local] Executing: ${schedule.name} (${schedule.id})`)

    // Create execution run record
    const run = new ScheduledJobRun()
    run.scheduledJobId = schedule.id
    run.tenantId = schedule.tenantId
    run.organizationId = schedule.organizationId
    run.status = 'running'
    run.triggerType = 'scheduled'
    run.startedAt = new Date()
    // Note: payload field requires migration - commented out for now
    // run.payload = (schedule.targetPayload as any) || {}
    
    await em.persistAndFlush(run)

    // Emit started event
    await this.eventBus.emit('scheduler.job.started', {
      scheduleId: schedule.id,
      runId: run.id,
      scheduleName: schedule.name,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    })

    try {
      // Check feature flag if required
      if (schedule.requireFeature) {
        const hasFeature = await this.rbacService.tenantHasFeature(
          schedule.tenantId,
          schedule.requireFeature
        )
        
        if (!hasFeature) {
          run.status = 'skipped'
          run.finishedAt = new Date()
          await em.flush()

          await this.eventBus.emit('scheduler.job.skipped', {
            scheduleId: schedule.id,
            runId: run.id,
            reason: `Feature not enabled: ${schedule.requireFeature}`,
            tenantId: schedule.tenantId,
            organizationId: schedule.organizationId,
          })

          console.log(`[scheduler:local] Schedule skipped - feature not enabled: ${schedule.requireFeature}`)
          return
        }
      }

      // Enqueue to target queue
      if (schedule.targetType === 'queue' && schedule.targetQueue) {
        const queue = this.queueFactory(schedule.targetQueue)
        
        const payload = {
          ...((schedule.targetPayload as any) || {}),
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
        }

        const jobId = await queue.enqueue(payload)
        
        run.status = 'completed'
        run.finishedAt = new Date()
        run.resultPayload = { queueJobId: jobId, queueName: schedule.targetQueue }
        
        // Update schedule's last run time and calculate next run
        schedule.lastRunAt = new Date()
        const nextRun = recalculateNextRun(
          schedule.scheduleType,
          schedule.scheduleValue,
          schedule.timezone || 'UTC'
        )
        
        if (nextRun) {
          schedule.nextRunAt = nextRun
        }
        
        await em.flush()

        await this.eventBus.emit('scheduler.job.completed', {
          scheduleId: schedule.id,
          runId: run.id,
          queueJobId: jobId,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
        })
        
        console.log(`[scheduler:local] ✓ Enqueued to ${schedule.targetQueue}`, {
          queueJobId: jobId,
        })
      } else if (schedule.targetType === 'command' && schedule.targetCommand) {
        throw new Error('Command execution not yet supported')
      } else {
        throw new Error('Invalid target configuration')
      }
    } catch (error: any) {
      run.status = 'failed'
      run.errorMessage = error.message
      run.resultPayload = { errorStack: error.stack }
      run.finishedAt = new Date()
      await em.flush()

      await this.eventBus.emit('scheduler.job.failed', {
        scheduleId: schedule.id,
        runId: run.id,
        error: error.message,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
      })

      console.error(`[scheduler:local] Failed to execute schedule:`, {
        scheduleId: schedule.id,
        error: error.message,
      })
      
      throw error
    }
  }

  /**
   * Hash a string to a positive integer for PostgreSQL advisory locks
   * PostgreSQL advisory locks use bigint (64-bit), but we use 32-bit for safety
   */
  private hashStringToNumber(str: string): number {
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32-bit integer
    }
    // Ensure positive number
    return Math.abs(hash)
  }
}
