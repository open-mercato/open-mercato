import { asClass, asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  createRbacFallbackCache,
  isRbacDefaultCacheEnabled,
  resetRbacFallbackCache,
} from '@open-mercato/core/modules/auth/services/rbacDefaultCache'

export { resetRbacFallbackCache }

export function register(container: AppContainer) {
  // Register or override core auth service
  container.register({ authService: asClass(AuthService).scoped() })
  // RBAC service. The bare `asClass(...).scoped()` registration matches
  // develop and is the default. Setting `OM_RBAC_DEFAULT_CACHE=on` opts
  // into the in-process LRU fallback for deployments that don't wire a
  // shared CacheStrategy (CLI scripts, lean test bootstraps). Production
  // bootstraps that already register `cache` via `@open-mercato/cache`
  // preempt this fallback because the container's existing `cache`
  // registration wins when `RbacService` reaches for it.
  if (isRbacDefaultCacheEnabled()) {
    container.register({
      rbacService: asFunction((cradle: { em: EntityManager; cache?: CacheStrategy }) => {
        return new RbacService(cradle.em, cradle.cache ?? createRbacFallbackCache())
      }).scoped(),
    })
  } else {
    container.register({ rbacService: asClass(RbacService).scoped() })
  }
}
