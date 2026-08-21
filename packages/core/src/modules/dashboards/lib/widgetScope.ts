import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer, type AppContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

export type WidgetScopeContext = {
  container: AppContainer
  em: EntityManager
  tenantId: string
  organizationIds: string[] | null
}

function normalizeScopeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export async function resolveWidgetScope(
  req: Request,
  translate: (key: string, fallback?: string) => string,
  overrides?: { tenantId?: string | null; organizationId?: string | null }
): Promise<WidgetScopeContext> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    throw new CrudHttpError(401, { error: translate('dashboards.errors.unauthorized', 'Unauthorized') })
  }

  const forbiddenScope = () => new CrudHttpError(403, {
    error: translate('dashboards.errors.forbidden_scope', 'Requested scope is not accessible'),
  })

  const requestedTenantId = normalizeScopeId(overrides?.tenantId)
  const requestedOrganizationId = normalizeScopeId(overrides?.organizationId)
  const authTenantId = normalizeScopeId(auth.tenantId)
  const isSuperAdmin = auth.isSuperAdmin === true

  // Cross-tenant inspection is a superadmin-only branch. Everyone else is pinned to
  // the authenticated tenant, so a request-supplied tenant can only ever restate it.
  if (requestedTenantId && !isSuperAdmin && requestedTenantId !== authTenantId) {
    throw forbiddenScope()
  }

  const container = await createRequestContainer()
  // Request-supplied scope is passed to the resolver as a *request*, never trusted
  // directly: it pins a non-superadmin back to their authenticated tenant and only
  // honors an organization selection the caller's ACL actually grants. Each key is
  // omitted when no override was supplied so the caller's own scope cookies still apply.
  const scope = await resolveOrganizationScopeForRequest({
    container,
    auth,
    request: req,
    ...(requestedTenantId ? { tenantId: requestedTenantId } : {}),
    ...(requestedOrganizationId ? { selectedId: requestedOrganizationId } : {}),
  })

  const tenantId = normalizeScopeId(scope?.tenantId) ?? authTenantId
  if (!tenantId) {
    throw new CrudHttpError(400, { error: translate('dashboards.errors.tenant_required', 'Tenant context is required') })
  }
  // Defense in depth: the resolver already pins the tenant, so a surviving mismatch
  // means the requested tenant was not the one authorized — fail closed rather than
  // serve another tenant's rows.
  if (requestedTenantId && requestedTenantId !== tenantId) {
    throw forbiddenScope()
  }

  // An organization override is only accepted when the resolver honored it against the
  // caller's allowed set; `selectionRejected` marks a selection it refused to grant.
  if (requestedOrganizationId && (scope?.selectionRejected || scope?.selectedId !== requestedOrganizationId)) {
    throw forbiddenScope()
  }

  const organizationIds = (() => {
    if (scope?.selectedId) return [scope.selectedId]
    if (Array.isArray(scope?.filterIds) && scope.filterIds.length > 0) return scope.filterIds
    if (scope?.allowedIds === null) return null
    if (auth.orgId) return [auth.orgId]
    return [] as string[]
  })()

  if (organizationIds !== null && organizationIds.length === 0) {
    throw new CrudHttpError(400, { error: translate('dashboards.errors.organization_required', 'Organization context is required') })
  }

  const em = (container.resolve('em') as EntityManager)

  return {
    container,
    em,
    tenantId,
    organizationIds,
  }
}
