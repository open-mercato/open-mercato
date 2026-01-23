import { asClass, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createQueue } from '@open-mercato/queue'
import { SchedulerService } from './services/schedulerService.js'
import { SchedulerEngine } from './services/schedulerEngine.js'
import { BullMQSchedulerService } from './services/bullmqSchedulerService.js'
import { LocalSchedulerService } from './services/localSchedulerService.js'

export function register(container: AppContainer) {
  const queueStrategy = process.env.QUEUE_STRATEGY || 'local'

  // Register queueFactory that services can use to create queues
  // This factory captures the strategy and returns a function to create queues
  const queueFactory = (name: string) => {
    return createQueue(name, queueStrategy as 'local' | 'async')
  }
  container.register({
    queueFactory: asValue(queueFactory),
  })

  if (queueStrategy === 'async') {
    // Register BullMQ scheduler service for production (requires Redis)
    container.register({
      bullmqSchedulerService: asClass(BullMQSchedulerService)
        .singleton()
        .inject(() => ({
          em: () => container.resolve('em'),
          queueFactory,
        })),
    })
    console.log('[scheduler] Registered BullMQ strategy (async)')
  } else {
    // Register local scheduler service for development (no Redis required)
    // Manually inject dependencies with proper wrappers
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
    console.log('[scheduler] Registered local strategy (polling-based)')
  }

  // Register common services
  container.register({
    schedulerService: asClass(SchedulerService)
      .singleton()
      .inject(() => ({
        em: () => container.resolve('em'),
      })),
    schedulerEngine: asClass(SchedulerEngine)
      .singleton()
      .inject(() => ({
        em: () => container.resolve('em'),
        config: {
          strategy: queueStrategy,
          pollIntervalMs: parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS || '30000', 10),
          lockTimeoutMs: parseInt(process.env.SCHEDULER_LOCK_TIMEOUT_MS || '60000', 10),
        },
      })),
  })
}
