import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { createProgressService } from './lib/progressServiceImpl'

export function register(container: AppContainer) {
  container.register({
    progressService: {
      resolve: (c) => {
        const em = c.resolve<EntityManager>('em')
        const eventBus = c.resolve('eventBus') as { emit: (event: string, payload: Record<string, unknown>) => Promise<void> }
        return createProgressService(em, eventBus)
      },
    },
  })
}
