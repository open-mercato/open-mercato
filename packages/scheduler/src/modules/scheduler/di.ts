import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createQueue } from '@open-mercato/queue'
import { SchedulerService } from './services/schedulerService.js'
import { BullMQSchedulerService } from './services/bullmqSchedulerService.js'
import { LocalSchedulerService } from './services/localSchedulerService.js'
import { ScheduledJobSubscriber } from './lib/scheduledJobSubscriber.js'

// Process-level guard: ensures BullMQ sync runs at most once per process lifetime.
let schedulerSynced = false

/**
 * Scheduler module DI registration
 * 
 * Supports two modes:
 * - async (production): BullMQ-based scheduling with Redis
 * - local (development): Simple polling for local dev without Redis
 * 
 * Set QUEUE_STRATEGY=async for production use.
 */
export function register(container: AppContainer) {
  const queueStrategy = process.env.QUEUE_STRATEGY || 'local'

  if (queueStrategy === 'async') {
    // Register BullMQ scheduler service for production (requires Redis)
    container.register({
      bullmqSchedulerService: asClass(BullMQSchedulerService)
        .singleton()
        .disposer((service) => service.destroy())
        .inject(() => ({
          em: () => container.resolve('em'),
        })),
    })
    // Register MikroORM subscriber for automatic BullMQ sync
    try {
      const em = container.resolve('em') as any
      if (em && em.getEventManager) {
        const subscriber = new ScheduledJobSubscriber()
        // Store container reference so subscriber can resolve BullMQ service
        ;(subscriber as any).__container = container
        em.getEventManager().registerSubscriber(subscriber)
      }
    } catch (error) {
      // Best-effort registration - don't break if EM not available yet
      console.warn('[scheduler] Could not register subscriber:', error)
    }

    // Cold start sync: reconcile DB schedules with BullMQ repeatable jobs.
    // Deferred so it doesn't block DI registration. Runs once per process.
    if (!schedulerSynced) {
      schedulerSynced = true
      setImmediate(() => {
        const service = container.resolve('bullmqSchedulerService') as BullMQSchedulerService
        service.syncAll()
          .then(() => console.log('[scheduler] BullMQ cold start sync complete'))
          .catch((err: Error) => console.error('[scheduler] BullMQ cold start sync failed:', err.message))
      })
    }
  } else {
    // Register local scheduler service for development (no Redis required)
    const queueFactory = (name: string) => createQueue(name, 'local')
    
    container.register({
      localSchedulerService: asClass(LocalSchedulerService)
        .singleton()
        .inject(() => ({
          em: () => container.resolve('em'),
          queueFactory,
          eventBus: container.resolve('eventBus'),
          rbacService: container.resolve('rbacService'),
          config: {
            pollIntervalMs: parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10),
          },
        })),
    })
  }

  // Register common API service
  container.register({
    schedulerService: asClass(SchedulerService)
      .singleton()
      .inject(() => ({
        em: () => container.resolve('em'),
        bullmqService: queueStrategy === 'async' 
          ? container.resolve('bullmqSchedulerService')
          : undefined,
      })),
  })
}
