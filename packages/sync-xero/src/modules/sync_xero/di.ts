import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { IntegrationOAuthGrantService } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { registerDataSyncAdapter } from '@open-mercato/core/modules/data_sync/lib/adapter-registry'
import { xeroContactsAdapter } from './lib/contacts/adapter'
import { createXeroHealthCheck } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void) => void) {
  activate(() => {
    registerDataSyncAdapter(xeroContactsAdapter)
  })

  container.register({
    xeroHealthCheck: asFunction(
      ({ integrationCredentialsService, integrationOAuthGrantService }: {
        integrationCredentialsService: CredentialsService
        integrationOAuthGrantService: IntegrationOAuthGrantService
      }) => createXeroHealthCheck({ credentialsService: integrationCredentialsService, grantService: integrationOAuthGrantService }),
    ).scoped().proxy(),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate) => registerProcessActivation(container, activate))
}, { legacy: register })
