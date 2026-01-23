import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { SchedulerService } from './services/schedulerService.js'
import { SchedulerEngine } from './services/schedulerEngine.js'
import { BullMQSchedulerService } from './services/bullmqSchedulerService.js'
import { LocalSchedulerService } from './services/localSchedulerService.js'

export function register(container: AppContainer) {
  const queueStrategy = process.env.QUEUE_STRATEGY || 'local'

  if (queueStrategy === 'async') {
    // Register BullMQ scheduler service for production (requires Redis)
    container.register({
      bullmqSchedulerService: asClass(BullMQSchedulerService).singleton(),
    })
    console.log('[scheduler] Registered BullMQ strategy (async)')
  } else {
    // Register local scheduler service for development (no Redis required)
    container.register({
      localSchedulerService: asClass(LocalSchedulerService).singleton(),
    })
    console.log('[scheduler] Registered local strategy (polling-based)')
  }

  // Register common services
  container.register({
    schedulerService: asClass(SchedulerService).singleton(),
    schedulerEngine: asClass(SchedulerEngine).singleton(), // Keep for backward compatibility
  })
}
