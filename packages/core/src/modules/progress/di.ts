import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createProgressService } from './lib/progressServiceImpl'

type ProgressEventBus = {
  emit: (
    event: string,
    payload: Record<string, unknown>,
    options?: { tenantId: string; organizationId: string | null },
  ) => Promise<void>
}

export function register(container: AppContainer) {
  container.register({
    progressService: {
      resolve: (c) => {
        const em = c.resolve<EntityManager>('em')
        const eventBus = c.resolve('eventBus') as ProgressEventBus
        return createProgressService(em, eventBus)
      },
    },
  })
}
