import type { EntityManager } from '@mikro-orm/core'
import type { Queue } from '@open-mercato/queue'
import { ScheduledJob } from '../data/entities'
import { recalculateNextRun } from './nextRunCalculator'
import { parseCronExpression } from './cronParser'
import { parseInterval } from './intervalParser'

/**
 * Service that manages BullMQ repeatable jobs for scheduled tasks.
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
  private queue: Queue<{ scheduleId: string }>
  
  constructor(
    private em: () => EntityManager,
    private queueFactory: (name: string) => Queue<any>,
  ) {
    // Get or create the scheduler-execution queue
    this.queue = this.queueFactory('scheduler-execution')
  }

  /**
   * Register a schedule with BullMQ repeatable jobs
   */
  async register(schedule: ScheduledJob): Promise<void> {
    if (!schedule.isEnabled) {
      console.log(`[scheduler:bullmq] Skipping disabled schedule: ${schedule.id}`)
      return
    }

    try {
      // Calculate next run time
      const nextRun = recalculateNextRun(
        schedule.scheduleType,
        schedule.scheduleValue,
        schedule.timezone
      )
      
      if (nextRun) {
        schedule.nextRunAt = nextRun
        await this.em().flush()
      }

      // Build BullMQ repeat options based on schedule type
      const repeatOpts = this.buildRepeatOptions(schedule)

      // Add repeatable job to BullMQ
      await (this.queue as any).add(
        `schedule-${schedule.id}`,
        { scheduleId: schedule.id },
        {
          repeat: repeatOpts,
          jobId: `schedule-${schedule.id}`, // Stable ID for updates
          removeOnComplete: true,
          removeOnFail: false, // Keep failed jobs for debugging
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
      // Remove repeatable job by key
      const repeatableJobs = await (this.queue as any).getRepeatableJobs?.()
      
      if (repeatableJobs) {
        for (const job of repeatableJobs) {
          if (job.id === `schedule-${scheduleId}` || job.name === `schedule-${scheduleId}`) {
            await (this.queue as any).removeRepeatableByKey?.(job.key)
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
    
    console.log('[scheduler:bullmq] Starting full sync...')

    // Get all BullMQ repeatable jobs
    const repeatableJobs = await (this.queue as any).getRepeatableJobs?.() || []
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
      return await (this.queue as any).getRepeatableJobs?.() || []
    } catch (error: any) {
      console.error('[scheduler:bullmq] Failed to get repeatable jobs:', error)
      return []
    }
  }
}
