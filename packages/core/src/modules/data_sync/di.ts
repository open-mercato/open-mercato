import { defineProcessDiRegistrar } from '@open-mercato/shared/lib/di/process-registrar'
import { resolveProgressService } from './lib/resolve-progress-service'
import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseBooleanWithDefault } from '@open-mercato/shared/lib/boolean'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../integrations/lib/log-service'
import type { IntegrationStateService } from '../integrations/lib/state-service'
import type { ProgressService } from '../progress/lib/progressService'
import { SyncCursor, SyncMapping, SyncRun, SyncSchedule } from './data/entities'
import { createExternalIdMappingService } from './lib/id-mapping'
import { createSyncRunService } from './lib/sync-run-service'
import { createSyncScheduleService } from './lib/sync-schedule-service'
import { createSyncEngine } from './lib/sync-engine'
import { registerBatchSizeFixture } from './__integration__/fixtures/batch-size-adapter'

type Cradle = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  integrationLogService: IntegrationLogService
  integrationStateService: IntegrationStateService
  progressService: ProgressService | null
  schedulerService?: {
    register: (registration: Record<string, unknown>) => Promise<void>
    unregister: (scheduleId: string) => Promise<void>
    exists?: (scheduleId: string) => Promise<boolean>
  }
}

export function register(container: AppContainer) {
  if (parseBooleanWithDefault(process.env.OM_INTEGRATION_TEST, false)) registerBatchSizeFixture()

  container.register({
    externalIdMappingService: asFunction(({ em }: Cradle) => createExternalIdMappingService(em)).scoped().proxy(),
    dataSyncRunService: asFunction(({ em }: Cradle) => createSyncRunService(em)).scoped().proxy(),
    dataSyncScheduleService: asFunction(({ em, schedulerService }: Cradle) => createSyncScheduleService(em, schedulerService)).proxy()
      .inject(scope => ({ schedulerService: scope.resolve('schedulerService', { allowUnregistered: true }) }))
      .scoped(),
    dataSyncEngine: asFunction(({ em, dataSyncRunService, integrationCredentialsService, integrationLogService, integrationStateService, progressService }: Cradle & {
      dataSyncRunService: ReturnType<typeof createSyncRunService>
    }) => createSyncEngine({
      em,
      syncRunService: dataSyncRunService,
      integrationCredentialsService,
      integrationLogService,
      integrationStateService,
      progressService,
    })).proxy().inject(scope => ({ progressService: resolveProgressService(scope) }))
      .scoped(),

    SyncRun: asValue(SyncRun),
    SyncCursor: asValue(SyncCursor),
    SyncMapping: asValue(SyncMapping),
    SyncSchedule: asValue(SyncSchedule),
  })
}

defineProcessDiRegistrar(register)
