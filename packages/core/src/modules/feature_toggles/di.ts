import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { isFeatureEnabled } from './lib/feature-flag-check'

export function register(container: AppContainer) {
  container.register({
    isFeatureEnabled: asFunction(() => isFeatureEnabled).scoped(),
  })
}
