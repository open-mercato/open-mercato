import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultApiKeyPrincipalService } from './services/principalService'

export function register(container: AppContainer) {
  container.register({ apiKeyPrincipalService: asClass(DefaultApiKeyPrincipalService).scoped() })
}
