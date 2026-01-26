import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities'
import { recalculateNextRun } from './nextRunCalculator'
import { parseCronExpression } from './cronParser'
import { parseInterval } from './intervalParser'

// Import BullMQ directly for repeatable jobs functionality
type BullQueue = any // We'll use dynamic import to avoid hard dependency

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
  private redisUrl: string
  
  constructor(
    private em: () => EntityManager,
  ) {
    // Get Redis URL from environment
    this.redisUrl = process.env.REDIS_URL || process.env.QUEUE_REDIS_URL || 'redis://localhost:6379'
  }

  /**
   * Lazy-load and return the BullMQ queue instance
   */
  private async getQueue(): Promise<BullQueue> {
    if (!this.queue) {
      try {
        const { Queue } = await import('bullmq')
        this.queue = new Queue('scheduler-execution', {
          connection: this.redisUrl as any,
        })
      } catch (error: any) {
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
      console.log(`[scheduler:bullmq] Skipping disabled schedule: ${schedule.id}`)
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
      
      console.log(`[scheduler:bullmq] Adding repeatable job with data:`, {
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

      console.log(`[scheduler:bullmq] Registered schedule: ${schedule.name} (${schedule.id})`, {
        type: schedule.scheduleType,
        pattern: schedule.scheduleValue,
        timezone: schedule.timezone,
      })
    } catch (error: any) {
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
            console.log(`[scheduler:bullmq] Unregistered schedule: ${scheduleId}`)
            return
          }
        }
      }

      console.log(`[scheduler:bullmq] No repeatable job found for schedule: ${scheduleId}`)
    } catch (error: any) {
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
    
    console.log('[scheduler:bullmq] Starting full sync...')

    // Get all BullMQ repeatable jobs
    const repeatableJobs = await queue.getRepeatableJobs?.() || []
    const bullmqScheduleIds = new Set<string>(
      repeatableJobs
        .filter((j: any) => j.id?.startsWith('schedule-') || j.name?.startsWith('schedule-'))
        .map((j: any) => String(j.id || j.name).replace('schedule-', ''))
    )

    // Get all enabled schedules from database
    const dbSchedules = await em.find(ScheduledJob, {
      isEnabled: true,
      deletedAt: null,
    })

    const dbScheduleIds = new Set(dbSchedules.map(s => s.id))

    // Register schedules that exist in DB but not in BullMQ
    for (const schedule of dbSchedules) {
      if (!bullmqScheduleIds.has(schedule.id)) {
        console.log(`[scheduler:bullmq] Registering missing schedule: ${schedule.name}`)
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

    console.log(`[scheduler:bullmq] Sync complete - ${dbSchedules.length} schedules active`)
  }

  /**
   * Build BullMQ repeat options from schedule configuration
   */
  private buildRepeatOptions(schedule: ScheduledJob): any {
    const opts: any = {
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
  async getRepeatableJobs(): Promise<any[]> {
    try {
      const queue = await this.getQueue()
      return await queue.getRepeatableJobs?.() || []
    } catch (error: any) {
      console.error('[scheduler:bullmq] Failed to get repeatable jobs:', error)
      return []
    }
  }
}
