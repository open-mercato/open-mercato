import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createStoreContextService } from './lib/storeContextService'

export function register(container: AppContainer) {
  container.register({
    storeContextService: asFunction(() => createStoreContextService(container)).scoped(),
  })
}
