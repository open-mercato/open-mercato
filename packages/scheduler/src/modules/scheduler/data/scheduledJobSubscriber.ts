import type { 
  EventArgs, 
  EventSubscriber, 
  FlushEventArgs 
} from '@mikro-orm/core'
import { ScheduledJob } from './entities'

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
  private bullmqService: any = null
  private queueStrategy: string

  constructor() {
    this.queueStrategy = process.env.QUEUE_STRATEGY || 'local'
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
  private async getBullMQService(): Promise<any> {
    if (this.queueStrategy !== 'async') {
      return null
    }

    if (!this.bullmqService) {
      try {
        // Container is attached to this subscriber instance during registration
        const container = (this as any).__container
        if (container?.hasRegistration?.('bullmqSchedulerService')) {
          this.bullmqService = container.resolve('bullmqSchedulerService')
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
        } catch (error: any) {
          // Don't throw - we don't want to break the transaction
          // BullMQ sync is best-effort, DB is source of truth
          console.error(`[scheduler:sync] Failed to sync with BullMQ:`, {
            scheduleId: schedule.id,
            scheduleName: schedule.name,
            changeType: changeSet.type,
            error: error.message,
          })
        }
      }
    }
  }
}
