import { asFunction, asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '../integrations/lib/credentials-service'
import type { IntegrationLogService } from '../integrations/lib/log-service'
import type { ProgressService } from '../progress/lib/progressService'
import { SyncCursor, SyncMapping, SyncRun, SyncSchedule } from './data/entities'
import { createExternalIdMappingService } from './lib/id-mapping'
import { createSyncRunService } from './lib/sync-run-service'
import { createSyncScheduleService } from './lib/sync-schedule-service'
import { createSyncEngine } from './lib/sync-engine'

type Cradle = {
  em: EntityManager
  integrationCredentialsService: CredentialsService
  integrationLogService: IntegrationLogService
  progressService: ProgressService
  schedulerService?: {
    register: (registration: Record<string, unknown>) => Promise<void>
    unregister: (scheduleId: string) => Promise<void>
  }
}

export function register(container: AppContainer) {
  container.register({
    externalIdMappingService: asFunction(({ em }: Cradle) => createExternalIdMappingService(em)).scoped().proxy(),
    dataSyncRunService: asFunction(({ em }: Cradle) => createSyncRunService(em)).scoped().proxy(),
    dataSyncScheduleService: asFunction(({ em, schedulerService }: Cradle) => createSyncScheduleService(em, schedulerService)).scoped().proxy(),
    dataSyncEngine: asFunction(({ em, dataSyncRunService, integrationCredentialsService, integrationLogService, progressService }: Cradle & {
      dataSyncRunService: ReturnType<typeof createSyncRunService>
    }) => createSyncEngine({
      em,
      syncRunService: dataSyncRunService,
      integrationCredentialsService,
      integrationLogService,
      progressService,
    })).scoped().proxy(),

    SyncRun: asValue(SyncRun),
    SyncCursor: asValue(SyncCursor),
    SyncMapping: asValue(SyncMapping),
    SyncSchedule: asValue(SyncSchedule),
  })
}
