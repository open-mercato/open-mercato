import type { EntityManager } from '@mikro-orm/core'
import type { Queue } from '@open-mercato/queue'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ScheduledJob } from '../data/entities'
import { LocalLockStrategy } from '../lib/localLockStrategy'
import { recalculateNextRun } from '../lib/nextRunCalculator'
import { emitSchedulerEvent } from '../events.js'
import { getGlobalEventBus } from '@open-mercato/shared/modules/events'

export interface RbacServiceLike {
  tenantHasFeature(tenantId: string | null | undefined, feature: string, opts?: { organizationId?: string | null }): Promise<boolean>
}

export interface LocalSchedulerConfig {
  pollIntervalMs: number
}

/**
 * Local scheduler service for development
 * 
 * This service polls the database for due schedules and executes them locally
 * without requiring Redis. Perfect for local development.
 * 
 * Features:
 * - PostgreSQL polling (configurable interval, default 30s)
 * - PostgreSQL advisory locks for duplicate prevention
 * - Supports both queue and command targets
 * - Emits the same events as async strategy
 * - Updates nextRunAt after execution
 * 
 * Limitations:
 * - Polling delay (up to configured interval)
 * - Single instance only (no distributed locking across instances)
 * - Higher database load than async strategy
 * 
 * Set QUEUE_STRATEGY=local to use this service.
 */
export class LocalSchedulerService {
  private isRunning = false
  private pollTimer?: NodeJS.Timeout
  private lockStrategy: LocalLockStrategy

  constructor(
    private em: () => EntityManager,
    private queueFactory: (name: string) => Queue,
    private rbacService: RbacServiceLike,
    private config: LocalSchedulerConfig = { pollIntervalMs: 30000 },
  ) {
    this.lockStrategy = new LocalLockStrategy(em)
  }

  /**
   * Start the local scheduler polling engine
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.warn('[scheduler:local] Already running')
      return
    }

    this.isRunning = true
    console.log('[scheduler:local] Starting polling engine...')
    console.log(`[scheduler:local] Poll interval: ${this.config.pollIntervalMs}ms`)

    // Run initial poll immediately
    await this.poll()

    // Schedule recurring polls
    this.pollTimer = setInterval(() => {
      this.poll().catch((error) => {
        console.error('[scheduler:local] Poll error:', error)
      })
    }, this.config.pollIntervalMs)

    console.log('[scheduler:local] ✓ Polling engine started')
  }

  /**
   * Stop the local scheduler
   */
  async stop(): Promise<void> {
    console.log('[scheduler:local] Stopping polling engine...')
    this.isRunning = false
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }

    console.log('[scheduler:local] ✓ Polling engine stopped')
  }

  /**
   * Poll for due schedules and execute them
   */
  private async poll(): Promise<void> {
    if (!this.isRunning) {
      return
    }

    const em = this.em().fork()

    try {
      // Find enabled schedules that are due (limited to avoid spikes after outages)
      const dueSchedules = await em.find(ScheduledJob, {
        isEnabled: true,
        deletedAt: null,
        nextRunAt: { $lte: new Date() },
      }, {
        limit: 100,
        orderBy: { nextRunAt: 'ASC' },
      })

      if (dueSchedules.length === 0) {
        console.log('[scheduler:local] No due schedules')
        return
      }

      console.log(`[scheduler:local] Found ${dueSchedules.length} due schedule(s)`)

      // Execute each schedule
      for (const schedule of dueSchedules) {
        await this.executeSchedule(schedule)
      }
    } catch (error: unknown) {
      console.error('[scheduler:local] Poll failed:', error)
    }
  }

  /**
   * Execute a single schedule
   */
  private async executeSchedule(schedule: ScheduledJob): Promise<void> {
    const lockKey = `schedule:${schedule.id}`

    // Try to acquire lock to prevent duplicate execution
    const acquired = await this.lockStrategy.tryLock(lockKey)
    
    if (!acquired) {
      console.log(`[scheduler:local] Schedule ${schedule.name} is already locked, skipping`)
      return
    }

    try {
      console.log(`[scheduler:local] Executing schedule: ${schedule.name} (${schedule.id})`)

      // Emit started event
      await emitSchedulerEvent('scheduler.job.started', {
        id: schedule.id,
        tenantId: schedule.tenantId,
        organizationId: schedule.organizationId,
        scheduleName: schedule.name,
        scopeType: schedule.scopeType,
        triggerType: 'scheduled',
        startedAt: new Date(),
      })

      try {
        // Check feature flag if required
        if (schedule.requireFeature) {
          const hasFeature = await this.checkFeature(schedule)
          
          if (!hasFeature) {
            console.log(`[scheduler:local] Schedule ${schedule.name} skipped: missing feature ${schedule.requireFeature}`)
            
            await emitSchedulerEvent('scheduler.job.skipped', {
              id: schedule.id,
              tenantId: schedule.tenantId,
              organizationId: schedule.organizationId,
              scheduleName: schedule.name,
              scopeType: schedule.scopeType,
              reason: `Missing required feature: ${schedule.requireFeature}`,
              skippedAt: new Date(),
            })

            // Still update next run time
            await this.updateNextRun(schedule)
            return
          }
        }

        // Execute based on target type
        if (schedule.targetType === 'queue') {
          await this.executeQueueTarget(schedule)
        } else if (schedule.targetType === 'command') {
          await this.executeCommandTarget(schedule)
        } else {
          throw new Error(`Unknown target type: ${schedule.targetType}`)
        }

        // Update last run and next run times
        const em = this.em().fork()
        const freshSchedule = await em.findOne(ScheduledJob, { id: schedule.id })
        
        if (freshSchedule) {
          freshSchedule.lastRunAt = new Date()
          
          // Calculate next run time
          const nextRun = recalculateNextRun(
            freshSchedule.scheduleType,
            freshSchedule.scheduleValue,
            freshSchedule.timezone
          )
          
          if (nextRun) {
            freshSchedule.nextRunAt = nextRun
          }
          
          await em.flush()
        }

        console.log(`[scheduler:local] ✓ Schedule ${schedule.name} completed successfully`)

        // Emit completed event
        await emitSchedulerEvent('scheduler.job.completed', {
          id: schedule.id,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
          scheduleName: schedule.name,
          scopeType: schedule.scopeType,
          completedAt: new Date(),
        })
      } catch (error: unknown) {
        console.error(`[scheduler:local] ✗ Schedule ${schedule.name} failed:`, error)

        // Emit failed event
        await emitSchedulerEvent('scheduler.job.failed', {
          id: schedule.id,
          tenantId: schedule.tenantId,
          organizationId: schedule.organizationId,
          scheduleName: schedule.name,
          scopeType: schedule.scopeType,
          error: error instanceof Error ? error.message : String(error),
          failedAt: new Date(),
        })

        // Still update next run time even on failure
        await this.updateNextRun(schedule)
      }
    } finally {
      // Always release the lock
      await this.lockStrategy.unlock(lockKey)
    }
  }

  /**
   * Execute a queue-based target
   */
  private async executeQueueTarget(schedule: ScheduledJob): Promise<void> {
    if (!schedule.targetQueue) {
      throw new Error('Target queue is required for queue target type')
    }

    const queue = this.queueFactory(schedule.targetQueue)
    
    await queue.enqueue({
      scheduleId: schedule.id,
      scheduleName: schedule.name,
      scopeType: schedule.scopeType,
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
      payload: schedule.targetPayload || {},
      triggeredAt: new Date(),
    })

    console.log(`[scheduler:local] Enqueued job to queue: ${schedule.targetQueue}`)
  }

  /**
   * Execute a command-based target
   */
  private async executeCommandTarget(schedule: ScheduledJob): Promise<void> {
    if (!schedule.targetCommand) {
      throw new Error('Target command is required for command target type')
    }

    const commandBus = new CommandBus()
    
    const commandInput = {
      ...((schedule.targetPayload as Record<string, unknown>) || {}),
      tenantId: schedule.tenantId,
      organizationId: schedule.organizationId,
    }
    
    // Build command context with tenant/org scope but no user
    // Commands run without user authentication for scheduled jobs
    const commandCtx: CommandRuntimeContext = {
      container: {
        resolve: (name: string) => {
          // Simple resolver that forwards to our dependencies
          if (name === 'em') return this.em()
          if (name === 'eventBus') return getGlobalEventBus()
          if (name === 'rbacService') return this.rbacService
          throw new Error(`Service not available in scheduler context: ${name}`)
        },
      } as CommandRuntimeContext['container'],
      auth: null, // Scheduled commands run without user authentication
      organizationScope: null,
      selectedOrganizationId: schedule.organizationId || null,
      organizationIds: schedule.organizationId ? [schedule.organizationId] : null,
      request: undefined,
    }

    const result = await commandBus.execute(schedule.targetCommand, {
      input: commandInput,
      ctx: commandCtx,
    })

    console.log(`[scheduler:local] Executed command: ${schedule.targetCommand}`, result)
  }

  /**
   * Check if user/tenant has required feature
   */
  private async checkFeature(schedule: ScheduledJob): Promise<boolean> {
    if (!schedule.requireFeature) {
      return true
    }

    try {
      // For system-scoped schedules, no RBAC check needed
      if (schedule.scopeType === 'system') {
        return true
      }

      // For tenant/org scoped schedules, check if ANY admin user has the feature
      // This is a simplified check - in reality, scheduled jobs run without a user context
      // so we're just checking if the feature is enabled for the tenant
      const hasFeature = await this.rbacService.tenantHasFeature(
        schedule.tenantId,
        schedule.requireFeature,
        {
          organizationId: schedule.organizationId,
        }
      )

      return hasFeature
    } catch (error: unknown) {
      console.error('[scheduler:local] Feature check failed:', error)
      return false
    }
  }

  /**
   * Update next run time for a schedule
   */
  private async updateNextRun(schedule: ScheduledJob): Promise<void> {
    const em = this.em().fork()
    const freshSchedule = await em.findOne(ScheduledJob, { id: schedule.id })
    
    if (freshSchedule) {
      const nextRun = recalculateNextRun(
        freshSchedule.scheduleType,
        freshSchedule.scheduleValue,
        freshSchedule.timezone
      )
      
      if (nextRun) {
        freshSchedule.nextRunAt = nextRun
        await em.flush()
      }
    }
  }
}
