import { asClass, asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
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
  // RBAC service — when no shared `cache` is registered in DI (e.g., CLI
  // contexts, lean test bootstraps) and OM_RBAC_DEFAULT_CACHE !== 'off',
  // fall back to a process-scoped LRU so warm requests do not pay 3-5
  // SQL queries per call. When a shared cache IS registered, we still
  // pass it through so tag-based invalidation keeps working.
  container.register({
    rbacService: asFunction((cradle: any) => {
      const em = cradle.em
      let cache: any = null
      try { cache = cradle.cache } catch { cache = null }
      if (!cache && isRbacDefaultCacheEnabled()) {
        cache = createRbacFallbackCache()
      }
      return new RbacService(em, cache)
    }).scoped(),
  })
}
