import { defineProcessDiRegistrar, asScopedService } from '@open-mercato/shared/lib/di/process-registrar'
import { asClass } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { DefaultApiKeyPrincipalService } from './services/principalService'
import { createApiKeyOneTimeIssuer } from './services/oneTimeIssuerService'

export function register(container: AppContainer) {
  container.register({
    apiKeyPrincipalService: asClass(DefaultApiKeyPrincipalService).scoped(),
    apiKeyOneTimeIssuer: asScopedService((scope) => createApiKeyOneTimeIssuer(scope.resolve<EntityManager>('em'))),
  })
}

defineProcessDiRegistrar(register)
