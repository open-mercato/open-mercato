import { asClass, asFunction } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { CustomerTokenService } from '@open-mercato/core/modules/customer_accounts/services/customerTokenService'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { CustomerInvitationService } from '@open-mercato/core/modules/customer_accounts/services/customerInvitationService'
import { DomainMappingService } from '@open-mercato/core/modules/customer_accounts/services/domainMappingService'

type DomainCacheService = {
  get: (key: string, options?: unknown) => Promise<unknown>
  set: (key: string, value: unknown, options?: { ttl?: number; tags?: string[] }) => Promise<void>
  deleteByTags: (tags: string[]) => Promise<number>
}

function isDomainCacheService(candidate: unknown): candidate is DomainCacheService {
  if (!candidate || typeof candidate !== 'object') return false
  const c = candidate as Record<string, unknown>
  return typeof c.get === 'function' && typeof c.set === 'function' && typeof c.deleteByTags === 'function'
}

export function register(container: AppContainer) {
  container.register({ customerUserService: asClass(CustomerUserService).scoped() })
  container.register({ customerSessionService: asClass(CustomerSessionService).scoped() })
  container.register({ customerTokenService: asClass(CustomerTokenService).scoped() })
  container.register({ customerRbacService: asClass(CustomerRbacService).scoped() })
  container.register({ customerInvitationService: asClass(CustomerInvitationService).scoped() })
  container.register({
    domainMappingService: asFunction(
      function domainMappingServiceFactory(em: EntityManager) {
        // Resolve the cache lazily so registrations from `bootstrap(container)` (which runs after
        // module DI registrars) are visible. Awilix CLASSIC mode would fail to resolve a
        // destructured `cache` param if the key is not yet registered; using `hasRegistration`
        // keeps construction safe for CLI/test contexts where `cache` may never be wired.
        let cacheService: DomainCacheService | undefined
        try {
          if (container.hasRegistration('cache')) {
            const candidate = container.resolve('cache')
            if (isDomainCacheService(candidate)) cacheService = candidate
          }
        } catch {
          cacheService = undefined
        }
        return new DomainMappingService(em, cacheService ? { cacheService } : undefined)
      },
    ).scoped(),
  })
}
