import { defineProcessDiRegistrar, asScopedService } from '@open-mercato/shared/lib/di/process-registrar'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createStoreContextService } from './lib/storeContextService'

export function register(container: AppContainer) {
  container.register({
    storeContextService: asScopedService((scope) => createStoreContextService(scope)),
  })
}

defineProcessDiRegistrar(register)
