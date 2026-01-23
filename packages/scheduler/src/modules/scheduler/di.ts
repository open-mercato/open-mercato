import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { SchedulerService } from './services/schedulerService.js'
import { SchedulerEngine } from './services/schedulerEngine.js'
import { BullMQSchedulerService } from './services/bullmqSchedulerService.js'

export function register(container: AppContainer) {
  // Register BullMQ scheduler service (optional - only for async strategy)
  const queueStrategy = process.env.QUEUE_STRATEGY || 'local'
  if (queueStrategy === 'async') {
    container.register({
      bullmqSchedulerService: asClass(BullMQSchedulerService).singleton(),
    })
  }

  // Register scheduler services
  container.register({
    schedulerService: asClass(SchedulerService).singleton(),
    schedulerEngine: asClass(SchedulerEngine).singleton(), // Keep for backward compatibility
  })
}
