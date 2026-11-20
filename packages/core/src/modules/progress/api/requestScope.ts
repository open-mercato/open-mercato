import type { AwilixContainer } from 'awilix'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import type {
  OrganizationScope,
  OrganizationScopeService,
} from '@open-mercato/shared/lib/auth/principal-service'

export async function resolveProgressRequestScope(
  container: AwilixContainer,
  auth: NonNullable<AuthContext>,
  request: Request,
): Promise<OrganizationScope> {
  const tenantId = normalizeScopeId(auth.tenantId)
  if (tenantId === null) return deniedOrganizationScope()

  const organizationScopeService = container.resolve<OrganizationScopeService>('organizationScopeService')
  const scope = await organizationScopeService.resolveForRequest({ auth, request, tenantId })
  if (normalizeScopeId(scope.tenantId) !== tenantId) return deniedOrganizationScope()

  return { ...scope, tenantId }
}

function normalizeScopeId(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function deniedOrganizationScope(): OrganizationScope {
  return {
    selectedId: null,
    filterIds: [],
    allowedIds: [],
    tenantId: null,
    selectionRejected: true,
  }
}

export function hasReadableProgressScope(scope: OrganizationScope): scope is OrganizationScope & { tenantId: string } {
  return scope.tenantId !== null && (scope.filterIds === null || scope.filterIds.length > 0)
}

export function hasWritableProgressScope(scope: OrganizationScope): scope is OrganizationScope & { tenantId: string } {
  return hasReadableProgressScope(scope) && scope.selectionRejected !== true
}
