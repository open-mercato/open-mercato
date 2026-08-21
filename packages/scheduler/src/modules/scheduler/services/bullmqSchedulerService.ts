import type { EntityManager } from '@mikro-orm/core'
import { ScheduledJob } from '../data/entities.js'
import { recalculateNextRun } from '../lib/nextRunCalculator'
import { parseCronExpression } from '../lib/cronParser'
import { resolveScheduleIntervalMs } from '../lib/intervalParser'
import { getRedisUrlOrThrow, parseRedisUrl } from '@open-mercato/shared/lib/redis/connection'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('scheduler').child({ component: 'bullmq' })

interface BullJobScheduler {
  key: string
  name: string
  id?: string | null
}

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
  add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown>
  getRepeatableJobs?(): Promise<BullRepeatableJob[]>
  removeRepeatableByKey?(key: string): Promise<boolean>
  upsertJobScheduler?(
    id: string,
    repeatOptions: BullRepeatOptions,
    jobTemplate: { name: string; data: unknown; opts: Record<string, unknown> },
  ): Promise<unknown>
  getJobSchedulers?(): Promise<BullJobScheduler[]>
  removeJobScheduler?(id: string): Promise<boolean>
  close(): Promise<void>
}

type BullJobSchedulerQueue = BullQueue & Required<Pick<
  BullQueue,
  'upsertJobScheduler' | 'getJobSchedulers' | 'removeJobScheduler'
>>

/**
 * Production scheduler using BullMQ Job Schedulers.
 * 
 * Requires Redis. Set QUEUE_STRATEGY=async to use this service.
 * 
 * This service syncs database schedules with BullMQ's Job Scheduler mechanism.
 * When a schedule is created/updated/deleted in the database, this service
 * adds/updates/removes the corresponding BullMQ Job Scheduler.
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
        this.queue = new Queue('scheduler-execution', {
          connection: parseRedisUrl(getRedisUrlOrThrow('QUEUE')),
        })
      } catch {
        throw new Error('BullMQ is required for async scheduler. Install it with: npm install bullmq')
      }
    }
    return this.queue
  }

  private getScheduleJobName(scheduleId: string): string {
    return `schedule-${scheduleId}`
  }

  private getScheduleIdFromJobScheduler(job: BullJobScheduler): string | null {
    const candidate = [job.key, job.id, job.name]
      .find((value) => value?.startsWith('schedule-'))

    return candidate ? candidate.slice('schedule-'.length) : null
  }

  private isJobSchedulerForSchedule(job: BullJobScheduler, scheduleId: string): boolean {
    return this.getScheduleIdFromJobScheduler(job) === scheduleId
  }

  private isCanonicalJobScheduler(job: BullJobScheduler, scheduleId: string): boolean {
    return job.key === this.getScheduleJobName(scheduleId)
  }

  private supportsJobSchedulers(queue: BullQueue): queue is BullJobSchedulerQueue {
    return typeof queue.upsertJobScheduler === 'function'
      && typeof queue.getJobSchedulers === 'function'
      && typeof queue.removeJobScheduler === 'function'
  }

  private isRepeatableJobForSchedule(job: BullRepeatableJob, scheduleId: string): boolean {
    const jobName = this.getScheduleJobName(scheduleId)
    return job.id === jobName || job.name === jobName
  }

  private async removeLegacyRepeatableJobs(queue: BullQueue, scheduleId: string): Promise<number> {
    const repeatableJobs = await queue.getRepeatableJobs?.()
    if (!repeatableJobs || typeof queue.removeRepeatableByKey !== 'function') {
      return 0
    }

    let removed = 0
    for (const job of repeatableJobs) {
      if (!this.isRepeatableJobForSchedule(job, scheduleId)) continue
      await queue.removeRepeatableByKey(job.key)
      removed += 1
    }
    return removed
  }

  /**
   * Register a schedule with BullMQ Job Schedulers
   * @param schedule - The schedule to register
   * @param options - Optional configuration
   * @param options.skipNextRunUpdate - If true, skip updating nextRunAt (used when called from hooks)
   */
  async register(schedule: ScheduledJob, options: { skipNextRunUpdate?: boolean } = {}): Promise<void> {
    if (!schedule.isEnabled) {
      logger.debug('Skipping disabled schedule', { scheduleId: schedule.id })
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

      // Upsert the BullMQ Job Scheduler
      // IMPORTANT: Wrap in QueuedJob format to match queue strategy expectations
      // BullMQ will store this in job.data, and the async strategy worker expects
      // job.data to be a QueuedJob with id, payload, and createdAt
      const queue = await this.getQueue()
      const jobName = this.getScheduleJobName(schedule.id)
      
      // Job Scheduler instances use a stable ID in the data
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
      
      logger.debug('Upserting job scheduler', {
        jobName,
        scheduleId: schedule.id,
        scopeType: schedule.scopeType,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
        repeatOpts,
      })
      
      const jobOptions = {
        removeOnComplete: {
          age: 86400 * 30,
          count: 1000,
        },
        removeOnFail: {
          age: 86400 * 90,
          count: 5000,
        },
      }

      if (this.supportsJobSchedulers(queue)) {
        const existingJobSchedulers = await queue.getJobSchedulers()
        await queue.upsertJobScheduler(
          jobName,
          repeatOpts,
          {
            name: jobName,
            data: jobData,
            opts: jobOptions,
          },
        )
        for (const jobScheduler of existingJobSchedulers) {
          if (
            this.isJobSchedulerForSchedule(jobScheduler, schedule.id)
            && !this.isCanonicalJobScheduler(jobScheduler, schedule.id)
          ) {
            await queue.removeJobScheduler(jobScheduler.key)
          }
        }
      } else {
        await this.removeLegacyRepeatableJobs(queue, schedule.id)
        await queue.add(jobName, jobData, { repeat: repeatOpts, ...jobOptions })
      }

      logger.debug('Registered schedule', {
        scheduleId: schedule.id,
        scheduleName: schedule.name,
        type: schedule.scheduleType,
        pattern: schedule.scheduleValue,
        timezone: schedule.timezone,
      })
    } catch (error: unknown) {
      logger.error('Failed to register schedule', { scheduleId: schedule.id, err: error })
      throw error
    }
  }

  /**
   * Unregister a schedule from BullMQ Job Schedulers
   */
  async unregister(scheduleId: string): Promise<void> {
    try {
      const queue = await this.getQueue()
      if (this.supportsJobSchedulers(queue)) {
        const jobSchedulers = await queue.getJobSchedulers()
        const matchingJobSchedulers = jobSchedulers.filter((job) => (
          this.isJobSchedulerForSchedule(job, scheduleId)
        ))
        if (matchingJobSchedulers.length > 0) {
          for (const jobScheduler of matchingJobSchedulers) {
            await queue.removeJobScheduler(jobScheduler.key)
          }
          logger.debug('Unregistered schedule', { scheduleId })
        } else {
          logger.debug('No job scheduler found for schedule', { scheduleId })
        }
        return
      }

      const removed = await this.removeLegacyRepeatableJobs(queue, scheduleId)
      if (removed > 0) {
        logger.debug('Unregistered schedule', { scheduleId })
      } else {
        logger.debug('No repeatable job found for schedule', { scheduleId })
      }
    } catch (error: unknown) {
      logger.error('Failed to unregister schedule', { scheduleId, err: error })
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
    
    logger.debug('Starting full sync')

    const bullmqScheduleIds = new Set<string>()
    const bullmqScheduleCounts = new Map<string, number>()
    const canonicalJobSchedulerIds = new Set<string>()
    if (this.supportsJobSchedulers(queue)) {
      const jobSchedulers = await queue.getJobSchedulers()
      for (const job of jobSchedulers) {
        const scheduleId = this.getScheduleIdFromJobScheduler(job)
        if (!scheduleId) continue
        bullmqScheduleIds.add(scheduleId)
        bullmqScheduleCounts.set(scheduleId, (bullmqScheduleCounts.get(scheduleId) ?? 0) + 1)
        if (this.isCanonicalJobScheduler(job, scheduleId)) {
          canonicalJobSchedulerIds.add(scheduleId)
        }
      }
    } else {
      const repeatableJobs = await queue.getRepeatableJobs?.() ?? []
      for (const job of repeatableJobs) {
        const candidate = job.id?.startsWith('schedule-')
          ? job.id
          : job.name?.startsWith('schedule-')
            ? job.name
            : null
        if (!candidate) continue
        const scheduleId = candidate.slice('schedule-'.length)
        bullmqScheduleIds.add(scheduleId)
        bullmqScheduleCounts.set(scheduleId, (bullmqScheduleCounts.get(scheduleId) ?? 0) + 1)
      }
    }

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
        logger.debug('Registering missing schedule', { scheduleId: schedule.id, scheduleName: schedule.name })
        await this.register(schedule)
      } else if (
        (bullmqScheduleCounts.get(schedule.id) ?? 0) > 1
        || !canonicalJobSchedulerIds.has(schedule.id)
      ) {
        logger.info('Migrating legacy or duplicate job scheduler', { scheduleId: schedule.id })
        await this.register(schedule)
      }
    }

    // Remove BullMQ jobs that don't exist in DB or are disabled
    for (const scheduleId of bullmqScheduleIds) {
      if (!dbScheduleIds.has(scheduleId)) {
        logger.info('Removing orphaned schedule', { scheduleId })
        await this.unregister(String(scheduleId))
      }
    }

    logger.debug('Sync complete', { activeSchedules: dbSchedules.length })
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
      const parsedCron = parseCronExpression(schedule.scheduleValue, schedule.timezone || 'UTC')
      if (!parsedCron.isValid) {
        throw new Error(parsedCron.error || 'Invalid cron expression')
      }
      opts.pattern = schedule.scheduleValue
    } else if (schedule.scheduleType === 'interval') {
      // Parse interval (e.g., "15m", "2h", "1d")
      const intervalMs = resolveScheduleIntervalMs(schedule.scheduleValue)
      opts.every = intervalMs
    } else {
      throw new Error(`Unsupported schedule type: ${schedule.scheduleType}`)
    }

    return opts
  }

  /**
   * Get list of all scheduled jobs from BullMQ
   */
  async getRepeatableJobs(): Promise<unknown[]> {
    try {
      const queue = await this.getQueue()
      if (this.supportsJobSchedulers(queue)) {
        return await queue.getJobSchedulers()
      }
      return await queue.getRepeatableJobs?.() ?? []
    } catch (error) {
      logger.error('Failed to get job schedulers', { err: error })
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
        logger.debug('Queue connection closed')
      } catch (error) {
        logger.error('Error closing queue', { err: error })
      }
    }
  }
}
