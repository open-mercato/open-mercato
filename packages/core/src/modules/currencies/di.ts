import type { AppContainer } from '@/lib/di/container'
import type { EntityManager } from '@mikro-orm/core'
import { RateFetchingService } from './services/rateFetchingService'
import { NBPProvider } from './services/providers/nbp'
import { RaiffeisenProvider } from './services/providers/raiffeisen'

export function register(container: AppContainer) {
  container.register({
    rateFetchingService: {
      resolve: (c) => {
        const em = c.resolve<EntityManager>('em')
        const service = new RateFetchingService(em)
        
        // Register default providers
        service.registerProvider(new NBPProvider())
        service.registerProvider(new RaiffeisenProvider())
        
        return service
      },
    },
  })
}

