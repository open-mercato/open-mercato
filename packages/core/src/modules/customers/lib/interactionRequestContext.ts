import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

type AuthContext = NonNullable<Awaited<ReturnType<typeof getAuthFromRequest>>>
type AuthContextWithTenant = AuthContext & { tenantId: string }

export type CustomersRequestContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  auth: AuthContextWithTenant
  em: EntityManager
  scope: Awaited<ReturnType<typeof resolveOrganizationScopeForRequest>>
  selectedOrganizationId: string | null
  organizationIds: string[] | null
  commandContext: CommandRuntimeContext
}

export function resolveAuthActorId(
  auth: AuthContext,
): string {
  if (typeof auth.sub === 'string' && auth.sub.trim().length > 0) return auth.sub
  if (typeof auth.userId === 'string' && auth.userId.trim().length > 0) return auth.userId
  if (typeof auth.keyId === 'string' && auth.keyId.trim().length > 0) return auth.keyId
  return 'system'
}

export async function resolveCustomersRequestContext(request: Request): Promise<CustomersRequestContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'Unauthorized' })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const selectedOrganizationId = scope?.selectedId ?? auth.orgId ?? null
  const organizationIds = scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null)

  return {
    container,
    auth: auth as AuthContextWithTenant,
    em: (container.resolve('em') as EntityManager).fork(),
    scope,
    selectedOrganizationId,
    organizationIds,
    commandContext: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId,
      organizationIds,
      request,
    },
  }
}
