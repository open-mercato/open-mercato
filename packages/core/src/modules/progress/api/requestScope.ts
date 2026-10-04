import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type {
  OrganizationScope,
  OrganizationScopeService,
} from '@open-mercato/shared/lib/auth/principal-service'

export async function resolveProgressRequestScope(
  container: AwilixContainer,
  auth: AuthContext,
  request: Request,
): Promise<OrganizationScope> {
  const organizationScopeService = container.resolve<OrganizationScopeService>('organizationScopeService')
  return organizationScopeService.resolveForRequest({ auth, request })
}

export function hasReadableProgressScope(scope: OrganizationScope): scope is OrganizationScope & { tenantId: string } {
  return scope.tenantId !== null && (scope.filterIds === null || scope.filterIds.length > 0)
}

export function hasWritableProgressScope(scope: OrganizationScope): scope is OrganizationScope & { tenantId: string } {
  return hasReadableProgressScope(scope) && scope.selectionRejected !== true
}
