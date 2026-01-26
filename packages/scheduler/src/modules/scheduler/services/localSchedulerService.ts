import type { EntityManager } from '@mikro-orm/core'
import type { Queue } from '@open-mercato/queue'
import type { EventBus } from '@open-mercato/events'
import { ScheduledJob } from '../data/entities'

/**
 * Local scheduler service - DEPRECATED
 * 
 * This service is no longer supported. The scheduler module requires BullMQ (async strategy)
 * for execution history, retry support, and proper job tracking.
 * 
 * Please set QUEUE_STRATEGY=async in your environment to use the scheduler.
 */
export class LocalSchedulerService {
  private isRunning = false

  constructor(
    private em: () => EntityManager,
    private queueFactory: (name: string) => Queue,
    private eventBus: EventBus,
    private rbacService: any,
  ) {}

  /**
   * Start the local scheduler - throws error
   */
  async start(): Promise<void> {
    console.error('═'.repeat(80))
    console.error('[scheduler:local] ERROR: Local queue strategy is not supported for scheduler module')
    console.error('[scheduler:local] ')
    console.error('[scheduler:local] The scheduler requires QUEUE_STRATEGY=async to function properly.')
    console.error('[scheduler:local] ')
    console.error('[scheduler:local] Why? The scheduler needs:')
    console.error('[scheduler:local]   - Execution history tracking (BullMQ job state)')
    console.error('[scheduler:local]   - Retry support for failed jobs')
    console.error('[scheduler:local]   - Distributed locking (prevent duplicate executions)')
    console.error('[scheduler:local]   - Job logs and debugging info')
    console.error('[scheduler:local] ')
    console.error('[scheduler:local] To fix: Set QUEUE_STRATEGY=async in your .env file')
    console.error('[scheduler:local] You will also need Redis running (REDIS_URL)')
    console.error('═'.repeat(80))
    
    throw new Error('Scheduler module requires QUEUE_STRATEGY=async. Local strategy is no longer supported.')
  }

  /**
   * Stop the local scheduler
   */
  async stop(): Promise<void> {
    this.isRunning = false
  }
}
