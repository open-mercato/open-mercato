import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { ApiKeyEnvironmentPrivacyHandler } from './privacy'

export function register(container: AppContainer) {
  container.register({
    apiKeyEnvironmentPrivacyHandler: asClass(ApiKeyEnvironmentPrivacyHandler).scoped(),
  })
}
