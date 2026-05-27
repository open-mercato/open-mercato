import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { resetRbacFallbackCache } from '@open-mercato/core/modules/auth/services/rbacDefaultCache'

export { resetRbacFallbackCache }

export function register(container: AppContainer) {
  // Register or override core auth service
  container.register({ authService: asClass(AuthService).scoped() })
  // RBAC service. Phase 3's `asFunction` wrapper + default-LRU fallback is
  // temporarily reverted to match develop's `asClass(...).scoped()` exactly,
  // because the readiness probe (`Authenticated GET /api/customers/people`)
  // was returning 500 on the integration runtime and gating Phase 5 alone
  // did not clear it. Until cross-request safety of the asFunction-wrapped
  // path is re-verified end-to-end, ship with the original registration so
  // Phase 3's runtime behavior matches develop. `rbacDefaultCache` is left
  // in-tree (no behavior gated to it) for a follow-up that re-enables the
  // fallback behind an opt-in env flag.
  container.register({ rbacService: asClass(RbacService).scoped() })
}
