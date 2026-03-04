import { asFunction, asValue } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { IntegrationCredentials, IntegrationLog, IntegrationState, SyncExternalIdMapping } from './data/entities'
import { createCredentialsService } from './lib/credentials-service'
import { createIntegrationStateService } from './lib/state-service'
import { createIntegrationLogService } from './lib/log-service'
import { createHealthService } from './lib/health-service'
import type { IntegrationStateService } from './lib/state-service'
import type { IntegrationLogService } from './lib/log-service'

type Cradle = {
  em: EntityManager
  integrationStateService: IntegrationStateService
  integrationLogService: IntegrationLogService
}

export function register(container: AppContainer) {
  container.register({
    integrationCredentialsService: asFunction(({ em }: Cradle) => createCredentialsService(em)).singleton().proxy(),
    integrationStateService: asFunction(({ em }: Cradle) => createIntegrationStateService(em)).singleton().proxy(),
    integrationLogService: asFunction(({ em }: Cradle) => createIntegrationLogService(em)).singleton().proxy(),
    integrationHealthService: asFunction(({ integrationStateService, integrationLogService }: Cradle) =>
      createHealthService(container, integrationStateService, integrationLogService),
    ).singleton().proxy(),
    SyncExternalIdMapping: asValue(SyncExternalIdMapping),
    IntegrationCredentials: asValue(IntegrationCredentials),
    IntegrationState: asValue(IntegrationState),
    IntegrationLog: asValue(IntegrationLog),
  })
}
