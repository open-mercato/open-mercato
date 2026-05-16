import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'

export async function resolveChampionCrmRequestContext(request: Request): Promise<CommandRuntimeContext & {
  auth: NonNullable<CommandRuntimeContext['auth']>
}> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) throw new CrudHttpError(401, { error: 'Unauthorized' })
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request })
  const selectedOrganizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!selectedOrganizationId) throw new CrudHttpError(400, { error: 'Organization context is required' })
  return {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId,
    organizationIds: scope?.filterIds ?? [selectedOrganizationId],
    request,
  }
}

export function resolveActorId(auth: NonNullable<CommandRuntimeContext['auth']>): string | null {
  const candidates = [auth.userId, auth.sub, auth.keyId]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && /^[0-9a-fA-F-]{36}$/.test(candidate)) return candidate
  }
  return null
}

