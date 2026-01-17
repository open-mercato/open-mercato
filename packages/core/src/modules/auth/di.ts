import { asClass } from 'awilix'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import { AuthService } from '@open-mercato/core/modules/auth/services/authService'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

export function register(container: AppContainer) {
  // Register or override core auth service
  container.register({ authService: asClass(AuthService).scoped() })
  // RBAC service
  container.register({ rbacService: asClass(RbacService).scoped() })
}
