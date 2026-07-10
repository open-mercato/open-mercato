import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { registerPhoneCallProvider } from '@open-mercato/shared/modules/phone_calls/provider'
import { tillioAdapter } from './lib/adapter'
import { createTillioEnvironmentHealthCheck, type CredentialsServiceLike } from './lib/health'

export function register(container: AppContainer) {
  registerPhoneCallProvider(tillioAdapter)

  container.register({
    tillioEnvironmentHealthCheck: asFunction(
      ({ integrationCredentialsService }: { integrationCredentialsService: CredentialsServiceLike }) =>
        createTillioEnvironmentHealthCheck({ credentialsService: integrationCredentialsService }),
    ).scoped().proxy(),
  })
}
