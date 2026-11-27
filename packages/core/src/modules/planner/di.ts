import { defineProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultPlannerAvailabilityService } from './services/plannerAvailabilityService'

export function register(container: AppContainer) {
  container.register({
    plannerAvailabilityService: asFunction(() => {
      return new DefaultPlannerAvailabilityService()
    }).scoped(),
  })
}

defineProcessDiRegistrar(register)
