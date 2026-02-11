import type { 
  EventArgs, 
  EventSubscriber, 
  FlushEventArgs 
} from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { ScheduledJob } from '../data/entities'
import type { BullMQSchedulerService } from '../services/bullmqSchedulerService'

/**
 * MikroORM Event Subscriber for ScheduledJob
 * 
 * Automatically syncs schedule changes with BullMQ when using async strategy.
 * 
 * This ensures that any database changes to schedules (via commands, direct ORM access,
 * or admin UI) are immediately reflected in BullMQ repeatable jobs.
 * 
 * Only runs when QUEUE_STRATEGY=async to avoid unnecessary work in local mode.
 */
export class ScheduledJobSubscriber implements EventSubscriber<ScheduledJob> {
  private bullmqService: BullMQSchedulerService | null = null
  private queueStrategy: string
  private container: AwilixContainer | null = null

  constructor() {
    this.queueStrategy = process.env.QUEUE_STRATEGY || 'local'
  }

  /**
   * Set the DI container for resolving services.
   * Called during DI registration to provide access to the container.
   */
  setContainer(container: AwilixContainer): void {
    this.container = container
  }

  /**
   * Subscribe only to ScheduledJob entity
   */
  getSubscribedEntities() {
    return [ScheduledJob]
  }

  /**
   * Get BullMQ service from DI container
   * Only resolves if strategy is async
   */
  private async getBullMQService(): Promise<BullMQSchedulerService | null> {
    if (this.queueStrategy !== 'async') {
      return null
    }

    if (!this.bullmqService) {
      try {
        if (this.container?.hasRegistration?.('bullmqSchedulerService')) {
          this.bullmqService = this.container.resolve<BullMQSchedulerService>('bullmqSchedulerService')
        }
      } catch (error) {
        console.warn('[scheduler:sync] Could not resolve BullMQSchedulerService:', error)
      }
    }

    return this.bullmqService
  }

  /**
   * After flush: sync all changed schedules with BullMQ
   * 
   * This runs after the transaction commits, so we're guaranteed
   * the database state is consistent.
   */
  async afterFlush(args: FlushEventArgs): Promise<void> {
    if (this.queueStrategy !== 'async') {
      return
    }

    const bullmqService = await this.getBullMQService()
    if (!bullmqService) {
      return
    }

    const uow = args.uow
    const changeSets = uow.getChangeSets()

    for (const changeSet of changeSets) {
      if (changeSet.entity instanceof ScheduledJob) {
        const schedule = changeSet.entity

        try {
          if (changeSet.type === 'create' || changeSet.type === 'update') {
            // Skip BullMQ sync when only execution timestamps changed (lastRunAt/nextRunAt).
            // The worker updates these after every run — the repeatable job config hasn't changed.
            if (changeSet.type === 'update' && changeSet.payload) {
              const runTimeOnly = ['lastRunAt', 'nextRunAt', 'updatedAt']
              const changedFields = Object.keys(changeSet.payload)
              if (changedFields.length > 0 && changedFields.every(f => runTimeOnly.includes(f))) {
                continue
              }
            }

            // Register or update in BullMQ
            if (schedule.isEnabled && !schedule.deletedAt) {
              // Skip nextRunAt update since we're in afterFlush - it's already persisted
              await bullmqService.register(schedule, { skipNextRunUpdate: true })
              console.log(`[scheduler:sync] Synced ${changeSet.type} to BullMQ: ${schedule.name}`)
            } else {
              // Disabled or soft-deleted - remove from BullMQ
              await bullmqService.unregister(schedule.id)
              console.log(`[scheduler:sync] Removed from BullMQ: ${schedule.name}`)
            }
          } else if (changeSet.type === 'delete') {
            // Hard delete - remove from BullMQ
            await bullmqService.unregister(schedule.id)
            console.log(`[scheduler:sync] Removed from BullMQ (deleted): ${schedule.id}`)
          }
        } catch (error) {
          // Don't throw - we don't want to break the transaction
          // BullMQ sync is best-effort, DB is source of truth
          console.error(`[scheduler:sync] Failed to sync with BullMQ:`, {
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            changeType: changeSet.type,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
    }
  }
}
