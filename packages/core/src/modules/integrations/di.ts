import { asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { createIntegrationCredentialsService } from './lib/integration-credentials-service'
import { createIntegrationLogService } from './lib/integration-log-service'
import { createIntegrationStateService } from './lib/integration-state-service'

export function register(container: AppContainer): void {
  container.register({
    integrationCredentials: asFunction(({ em }) => createIntegrationCredentialsService(em)).scoped(),
    integrationLog: asFunction(({ em }) => createIntegrationLogService(em)).scoped(),
    integrationState: asFunction(({ em }) => createIntegrationStateService(em)).scoped(),
  })
}
