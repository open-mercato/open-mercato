import { defineProcessDiRegistrar, asScopedService } from '@open-mercato/shared/lib/di/process-registrar'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createModuleConfigService } from './lib/module-config-service'
import { createInstanceConfigInitializer } from './lib/instance-config-initializer'

export function register(container: AppContainer) {
  container.register({
    moduleConfigService: asScopedService(createModuleConfigService),
    instanceConfigInitializer: asScopedService(createInstanceConfigInitializer),
  })
}

defineProcessDiRegistrar(register)
