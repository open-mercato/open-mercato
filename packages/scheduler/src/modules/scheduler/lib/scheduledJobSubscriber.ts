import type {
  EventSubscriber,
  FlushEventArgs,
  TransactionEventArgs,
} from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { ScheduledJob } from '../data/entities.js'
import type { BullMQSchedulerService } from '../services/bullmqSchedulerService'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('scheduler').child({ component: 'sync' })

type ScheduleSync = {
  schedule: ScheduledJob
  action: 'register' | 'unregister'
  changeType: string
}

type SyncBatch = Map<string, ScheduleSync>

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
  private readonly pendingByTransaction = new WeakMap<object, SyncBatch>()
  private readonly parentTransactions = new WeakMap<object, object>()
  private readonly savepointParentByEm = new WeakMap<object, object>()

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
        logger.warn('Could not resolve BullMQSchedulerService', { err: error })
      }
    }

    return this.bullmqService
  }

  /**
   * After flush: sync all changed schedules with BullMQ.
   *
   * A flush outside an explicit transaction has already committed (MikroORM wraps it in its own
   * implicit transaction), so the changes are synced right away. A flush inside an open transaction
   * has not: its changes are queued on that transaction and synced only after it commits, and
   * dropped if it rolls back. Redis is therefore never called while the transaction (and any lock
   * it holds) is still open.
   */
  async afterFlush(args: FlushEventArgs): Promise<void> {
    if (this.queueStrategy !== 'async') {
      return
    }

    const batch = this.collectScheduleSyncs(args)
    if (batch.size === 0) {
      return
    }

    const transaction = args.em.isInTransaction() ? args.em.getTransactionContext() : undefined
    if (transaction) {
      this.queueForTransaction(transaction, batch)
      return
    }

    await this.publish(batch)
  }

  beforeTransactionStart(args: TransactionEventArgs): void {
    if (this.queueStrategy !== 'async') return
    if (args.transaction) {
      this.savepointParentByEm.set(args.em, args.transaction)
    } else {
      this.savepointParentByEm.delete(args.em)
    }
  }

  afterTransactionStart(args: TransactionEventArgs): void {
    if (this.queueStrategy !== 'async') return
    const parent = this.savepointParentByEm.get(args.em)
    this.savepointParentByEm.delete(args.em)
    if (parent && args.transaction && args.transaction !== parent) {
      this.parentTransactions.set(args.transaction, parent)
    }
  }

  async afterTransactionCommit(args: TransactionEventArgs): Promise<void> {
    if (this.queueStrategy !== 'async' || !args.transaction) return
    const batch = this.pendingByTransaction.get(args.transaction)
    if (!batch) return
    this.pendingByTransaction.delete(args.transaction)

    const parent = this.parentTransactions.get(args.transaction)
    if (parent) {
      this.queueForTransaction(parent, batch)
      return
    }

    await this.publish(batch)
  }

  afterTransactionRollback(args: TransactionEventArgs): void {
    if (this.queueStrategy !== 'async' || !args.transaction) return
    const batch = this.pendingByTransaction.get(args.transaction)
    this.pendingByTransaction.delete(args.transaction)
    if (batch) {
      logger.debug('Discarded BullMQ sync for rolled back schedule changes', { scheduleIds: [...batch.keys()] })
    }
  }

  private queueForTransaction(transaction: object, batch: SyncBatch): void {
    const pending = this.pendingByTransaction.get(transaction) ?? new Map<string, ScheduleSync>()
    for (const [scheduleId, sync] of batch) {
      pending.set(scheduleId, sync)
    }
    this.pendingByTransaction.set(transaction, pending)
  }

  private collectScheduleSyncs(args: FlushEventArgs): SyncBatch {
    const batch: SyncBatch = new Map()
    for (const changeSet of args.uow.getChangeSets()) {
      if (!(changeSet.entity instanceof ScheduledJob)) continue
      const schedule = changeSet.entity

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
        const action = schedule.isEnabled && !schedule.deletedAt ? 'register' : 'unregister'
        batch.set(schedule.id, { schedule, action, changeType: changeSet.type })
      } else if (changeSet.type === 'delete') {
        batch.set(schedule.id, { schedule, action: 'unregister', changeType: changeSet.type })
      }
    }
    return batch
  }

  private async publish(batch: SyncBatch): Promise<void> {
    const bullmqService = await this.getBullMQService()
    if (!bullmqService) {
      return
    }

    for (const { schedule, action, changeType } of batch.values()) {
      try {
        if (action === 'register') {
          // Skip nextRunAt update since the schedule is already persisted
          await bullmqService.register(schedule, { skipNextRunUpdate: true })
          logger.info('Synced schedule to BullMQ', { changeType, scheduleId: schedule.id, scheduleName: schedule.name })
        } else {
          await bullmqService.unregister(schedule.id)
          logger.info('Removed schedule from BullMQ', { changeType, scheduleId: schedule.id, scheduleName: schedule.name })
        }
      } catch (error) {
        // Don't throw - BullMQ sync is best-effort, DB is source of truth
        logger.error('Failed to sync with BullMQ', {
          scheduleId: schedule.id,
          scheduleName: schedule.name,
          changeType,
          err: error,
        })
      }
    }
  }
}
