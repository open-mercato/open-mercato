import { asClass, asFunction } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CacheStrategy } from '@open-mercato/cache'
import type { OrganizationHierarchyService } from '@open-mercato/shared/lib/auth/principal-service'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  createRbacFallbackCache,
  isRbacDefaultCacheEnabled,
  resetRbacFallbackCache,
} from '@open-mercato/core/modules/auth/services/rbacDefaultCache'
import { DefaultAuthPrincipalService } from './services/principalService'

export { resetRbacFallbackCache }

function resolveOptionalCache(container: AppContainer): CacheStrategy | undefined {
  try {
    return container.hasRegistration('cache')
      ? container.resolve<CacheStrategy>('cache')
      : undefined
  } catch {
    return undefined
  }
}

function resolveOptionalOrganizationHierarchyService(
  container: AppContainer,
): OrganizationHierarchyService | undefined {
  try {
    if (!container.hasRegistration('organizationHierarchyService')) return undefined
    const candidate = container.resolve<OrganizationHierarchyService>('organizationHierarchyService')
    return typeof candidate?.resolveAncestorIds === 'function' ? candidate : undefined
  } catch {
    return undefined
  }
}

export function register(container: AppContainer) {
  // Register or override core auth service
  container.register({ authService: asClass(AuthService).scoped() })
  container.register({
    authPrincipalService: asFunction(function authPrincipalServiceFactory(cradle: { em: EntityManager }) {
      return new DefaultAuthPrincipalService(
        cradle.em,
        resolveOptionalOrganizationHierarchyService(container),
      )
    }).scoped().proxy(),
  })
  // Resolve optional infrastructure lazily so Auth still works when Directory
  // is disabled and in lean CLI/test containers without a CacheStrategy.
  // Setting `OM_RBAC_DEFAULT_CACHE=on` opts into the in-process fallback;
  // an explicitly registered cache always wins.
  container.register({
    rbacService: asFunction(function rbacServiceFactory(cradle: { em: EntityManager }) {
      const configuredCache = resolveOptionalCache(container)
      return new RbacService(
        cradle.em,
        configuredCache ?? (isRbacDefaultCacheEnabled() ? createRbacFallbackCache() : undefined),
        resolveOptionalOrganizationHierarchyService(container),
      )
    }).scoped().proxy(),
  })
}
