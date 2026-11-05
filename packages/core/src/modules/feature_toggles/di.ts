import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { FeatureTogglesService } from './lib/feature-flag-check'

export function register(container: AppContainer) {
  container.register({
    featureTogglesService: asClass(FeatureTogglesService).scoped(),
  })
}
