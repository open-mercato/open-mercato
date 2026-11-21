import { defineProcessDiRegistrar, registerProcessActivation } from '@open-mercato/shared/lib/di/process-registrar'
import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerPhoneCallProvider } from '@open-mercato/shared/modules/phone_calls/provider'
import { tillioAdapter } from './lib/adapter'
import { createTillioEnvironmentHealthCheck, type CredentialsServiceLike } from './lib/health'

function registerWithActivation(container: AppContainer, activate: (callback: () => void) => void) {
  activate(() => {
    registerPhoneCallProvider(tillioAdapter)
  })

  container.register({
    tillioEnvironmentHealthCheck: asFunction(
      ({ integrationCredentialsService }: { integrationCredentialsService: CredentialsServiceLike }) =>
        createTillioEnvironmentHealthCheck({ credentialsService: integrationCredentialsService }),
    ).scoped().proxy(),
  })
}

export function register(container: AppContainer): void {
  registerWithActivation(container, (activate) => activate())
}

defineProcessDiRegistrar((container: AppContainer) => {
  registerWithActivation(container, (activate) => registerProcessActivation(container, activate))
}, { legacy: register })
