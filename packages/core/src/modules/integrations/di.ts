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
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'

type Cradle = {
  em: EntityManager
  integrationStateService: IntegrationStateService
  integrationLogService: IntegrationLogService
  tenantEncryptionService: TenantDataEncryptionService
}

export function register(container: AppContainer) {
  container.register({
    integrationCredentialsService: asFunction(({ em, tenantEncryptionService }: Cradle) =>
      createCredentialsService(em, tenantEncryptionService),
    ).scoped().proxy(),
    integrationStateService: asFunction(({ em }: Cradle) => createIntegrationStateService(em)).scoped().proxy(),
    integrationLogService: asFunction(({ em }: Cradle) => createIntegrationLogService(em)).scoped().proxy(),
    integrationHealthService: asFunction(({ integrationStateService, integrationLogService }: Cradle) =>
      createHealthService(container, integrationStateService, integrationLogService),
    ).scoped().proxy(),
    SyncExternalIdMapping: asValue(SyncExternalIdMapping),
    IntegrationCredentials: asValue(IntegrationCredentials),
    IntegrationState: asValue(IntegrationState),
    IntegrationLog: asValue(IntegrationLog),
  })
}
