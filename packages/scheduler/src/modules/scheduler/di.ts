import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { SchedulerService } from './services/schedulerService.js'
import { SchedulerEngine } from './services/schedulerEngine.js'

export function register(container: AppContainer) {
  // Register scheduler services
  container.register({
    schedulerService: asClass(SchedulerService).singleton(),
    schedulerEngine: asClass(SchedulerEngine).singleton(),
  })
}
