import { asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'
import { createRecordLockService } from './lib/recordLockService'

export function register(container: AppContainer) {
  container.register({
    recordLockService: asFunction((em: EntityManager, moduleConfigService?: ModuleConfigService | null) =>
      createRecordLockService({ em, moduleConfigService: moduleConfigService ?? null }),
    ).scoped(),
  })
}
