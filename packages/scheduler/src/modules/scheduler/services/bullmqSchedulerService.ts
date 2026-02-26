import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities.js'
import { recalculateNextRun } from '../lib/nextRunCalculator'
import { parseCronExpression } from '../lib/cronParser'
import { parseInterval } from '../lib/intervalParser'
import { getRedisUrl, parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'

interface BullRepeatableJob {
  key: string
  name: string
  id?: string | null
}

interface BullRepeatOptions {
  tz?: string
  pattern?: string
  every?: number
}

interface BullQueue {
  add(name: string, data: unknown, opts?: unknown): Promise<unknown>
  getRepeatableJobs?(): Promise<BullRepeatableJob[]>
  removeRepeatableByKey?(key: string): Promise<boolean>
  close(): Promise<void>
}

/**
 * Production scheduler using BullMQ repeatable jobs.
 * 
 * Requires Redis. Set QUEUE_STRATEGY=async to use this service.
 * 
 * This service syncs database schedules with BullMQ's repeat mechanism.
 * When a schedule is created/updated/deleted in the database, this service
 * adds/updates/removes the corresponding BullMQ repeatable job.
 * 
 * BullMQ handles:
 * - Exact timing based on cron expressions or intervals
 * - Distributed locking across multiple instances
 * - Automatic retries if worker fails
 * 
 * The worker loads fresh schedule config from DB on each execution,
 * so updates to schedules take effect immediately.
 */
export class BullMQSchedulerService {
  private queue: BullQueue | null = null
  
  constructor(
    private em: () => EntityManager,
  ) {}

  /**
   * Lazy-load and return the BullMQ queue instance
   */
  private async getQueue(): Promise<BullQueue> {
    if (!this.queue) {
      try {
        const { Queue } = await import('bullmq')
        this.queue = new Queue('scheduler-execution', { connection: parseRedisUrl(getRedisUrl('QUEUE')) })
      } catch {
        throw new Error('BullMQ is required for async scheduler. Install it with: npm install bullmq')
      }
    }
    return this.queue
  }

  /**
   * Register a schedule with BullMQ repeatable jobs
   * @param schedule - The schedule to register
   * @param options - Optional configuration
   * @param options.skipNextRunUpdate - If true, skip updating nextRunAt (used when called from hooks)
   */
  async register(schedule: ScheduledJob, options: { skipNextRunUpdate?: boolean } = {}): Promise<void> {
    if (!schedule.isEnabled) {
      console.debug(`[scheduler:bullmq] Skipping disabled schedule: ${schedule.id}`)
      return
    }

    try {
      // Calculate and update next run time (unless skipped)
      if (!options.skipNextRunUpdate) {
        const nextRun = recalculateNextRun(
          schedule.scheduleType,
          schedule.scheduleValue,
          schedule.timezone
        )
        
        if (nextRun) {
          schedule.nextRunAt = nextRun
          // Flush will be handled by the caller
        }
      }

      // Build BullMQ repeat options based on schedule type
      const repeatOpts = this.buildRepeatOptions(schedule)

      // Add repeatable job to BullMQ
      // IMPORTANT: Wrap in QueuedJob format to match queue strategy expectations
      // BullMQ will store this in job.data, and the async strategy worker expects
      // job.data to be a QueuedJob with id, payload, and createdAt
      const queue = await this.getQueue()
      const jobName = `schedule-${schedule.id}`
      
      // For repeatable jobs, we need to provide a stable ID in the data
      // that will be used for each repeat instance
      // CRITICAL: Include scope information (tenantId, organizationId, scopeType)
      // for proper multi-tenant isolation and auditing
      const jobData = {
        id: jobName,
        payload: { 
          scheduleId: schedule.id,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
          scopeType: schedule.scopeType,
        },
        createdAt: new Date().toISOString(),
      }
      
      console.debug(`[scheduler:bullmq] Adding repeatable job with data:`, {
        jobName,
        scheduleId: schedule.id,
        scopeType: schedule.scopeType,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
        repeatOpts,
        jobData,
      })
      
      await queue.add(
        jobName, // Job name - used as part of repeatable job key
        jobData, // Job data in QueuedJob format
        {
          repeat: repeatOpts,
          // Don't set jobId for repeatable jobs - BullMQ generates unique IDs for each instance
          removeOnComplete: {
            age: 86400 * 30, // Keep completed jobs for 30 days (execution history)
            count: 1000,     // Keep last 1000 completed jobs
          },
          removeOnFail: {
            age: 86400 * 90, // Keep failed jobs for 90 days (debugging/audit)
            count: 5000,     // Keep last 5000 failed jobs
          },
        }
      )

      console.debug(`[scheduler:bullmq] Registered schedule: ${schedule.name} (${schedule.id})`, {
        type: schedule.scheduleType,
        pattern: schedule.scheduleValue,
        timezone: schedule.timezone,
      })
    } catch (error: unknown) {
      console.error(`[scheduler:bullmq] Failed to register schedule: ${schedule.id}`, error)
      throw error
    }
  }

  /**
   * Unregister a schedule from BullMQ repeatable jobs
   */
  async unregister(scheduleId: string): Promise<void> {
    try {
      const queue = await this.getQueue()
      
      // Remove repeatable job by key
      const repeatableJobs = await queue.getRepeatableJobs?.()
      
      if (repeatableJobs) {
        for (const job of repeatableJobs) {
          if (job.id === `schedule-${scheduleId}` || job.name === `schedule-${scheduleId}`) {
            await queue.removeRepeatableByKey?.(job.key)
            console.debug(`[scheduler:bullmq] Unregistered schedule: ${scheduleId}`)
            return
          }
        }
      }

      console.debug(`[scheduler:bullmq] No repeatable job found for schedule: ${scheduleId}`)
    } catch (error: unknown) {
      console.error(`[scheduler:bullmq] Failed to unregister schedule: ${scheduleId}`, error)
      throw error
    }
  }

  /**
   * Sync all enabled schedules with BullMQ
   * Useful for initialization or repair
   */
  async syncAll(): Promise<void> {
    const em = this.em().fork()
    const queue = await this.getQueue()
    
    console.debug('[scheduler:bullmq] Starting full sync...')

    // Get all BullMQ repeatable jobs
    const repeatableJobs = await queue.getRepeatableJobs?.() || []
    const bullmqScheduleIds = new Set<string>(
      repeatableJobs
        .filter((j) => j.id?.startsWith('schedule-') || j.name?.startsWith('schedule-'))
        .map((j) => String(j.id || j.name).replace('schedule-', ''))
    )

    // Get enabled schedules from database in batches to avoid unbounded loads
    const BATCH_SIZE = 500
    const dbSchedules: ScheduledJob[] = []
    let offset = 0
    let batch: ScheduledJob[]
    do {
      batch = await em.find(ScheduledJob, {
        isEnabled: true,
        deletedAt: null,
      }, { limit: BATCH_SIZE, offset })
      dbSchedules.push(...batch)
      offset += BATCH_SIZE
    } while (batch.length === BATCH_SIZE)

    const dbScheduleIds = new Set(dbSchedules.map(s => s.id))

    // Register schedules that exist in DB but not in BullMQ
    for (const schedule of dbSchedules) {
      if (!bullmqScheduleIds.has(schedule.id)) {
        console.debug(`[scheduler:bullmq] Registering missing schedule: ${schedule.name}`)
        await this.register(schedule)
      }
    }

    // Remove BullMQ jobs that don't exist in DB or are disabled
    for (const scheduleId of bullmqScheduleIds) {
      if (!dbScheduleIds.has(scheduleId)) {
        console.log(`[scheduler:bullmq] Removing orphaned schedule: ${scheduleId}`)
        await this.unregister(String(scheduleId))
      }
    }

    console.debug(`[scheduler:bullmq] Sync complete - ${dbSchedules.length} schedules active`)
  }

  /**
   * Build BullMQ repeat options from schedule configuration
   */
  private buildRepeatOptions(schedule: ScheduledJob): BullRepeatOptions {
    const opts: BullRepeatOptions = {
      tz: schedule.timezone || 'UTC',
    }

    if (schedule.scheduleType === 'cron') {
      // Validate cron expression
      parseCronExpression(schedule.scheduleValue, schedule.timezone || 'UTC')
      opts.pattern = schedule.scheduleValue
    } else if (schedule.scheduleType === 'interval') {
      // Parse interval (e.g., "15m", "2h", "1d")
      const intervalMs = parseInterval(schedule.scheduleValue)
      opts.every = intervalMs
    } else {
      throw new Error(`Unsupported schedule type: ${schedule.scheduleType}`)
    }

    return opts
  }

  /**
   * Get list of all repeatable jobs from BullMQ
   */
  async getRepeatableJobs(): Promise<unknown[]> {
    try {
      const queue = await this.getQueue()
      return await queue.getRepeatableJobs?.() || []
    } catch (error) {
      console.error('[scheduler:bullmq] Failed to get repeatable jobs:', error)
      return []
    }
  }

  /**
   * Close the cached BullMQ queue connection.
   * Must be called during graceful shutdown to prevent Redis connection leaks.
   */
  async destroy(): Promise<void> {
    if (this.queue) {
      try {
        await this.queue.close()
        this.queue = null
        console.debug('[scheduler:bullmq] Queue connection closed')
      } catch (error) {
        console.error('[scheduler:bullmq] Error closing queue:', error)
      }
    }
  }
}
