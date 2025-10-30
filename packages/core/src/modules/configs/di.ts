import { asValue } from 'awilix'
import type { AppContainer } from '@/lib/di/container'
import { createModuleConfigService } from './lib/module-config-service'

export function register(container: AppContainer) {
  const service = createModuleConfigService(container)
  container.register({
    moduleConfigService: asValue(service),
  })
}

