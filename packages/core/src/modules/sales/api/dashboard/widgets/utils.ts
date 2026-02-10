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

export async function resolveWidgetScope(
  req: Request,
  translate: (key: string, fallback?: string) => string,
  overrides?: { tenantId?: string | null; organizationId?: string | null }
): Promise<WidgetScopeContext> {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    throw new CrudHttpError(401, { error: translate('sales.errors.unauthorized', 'Unauthorized') })
  }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })

  const tenantId = overrides?.tenantId ?? auth.tenantId ?? null
  if (!tenantId) {
    throw new CrudHttpError(400, { error: translate('sales.errors.tenant_required', 'Tenant context is required') })
  }

  const organizationIds = (() => {
    if (overrides?.organizationId) return [overrides.organizationId]
    if (scope?.selectedId) return [scope.selectedId]
    if (Array.isArray(scope?.filterIds) && scope.filterIds.length > 0) return scope.filterIds
    if (scope?.allowedIds === null) return null
    if (auth.orgId) return [auth.orgId]
    return [] as string[]
  })()

  if (organizationIds !== null && organizationIds.length === 0) {
    throw new CrudHttpError(400, { error: translate('sales.errors.organization_required', 'Organization context is required') })
  }

  const em = container.resolve('em') as EntityManager

  return {
    container,
    em,
    tenantId,
    organizationIds,
  }
}
