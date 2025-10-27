import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export type DictionariesRouteContext = {
  container: AwilixContainer
  ctx: CommandRuntimeContext
  auth: Awaited<ReturnType<typeof getAuthFromRequest>>
  em: EntityManager
  organizationId: string
  tenantId: string
  readableOrganizationIds: string[]
  translate: (key: string, fallback?: string) => string
}

export async function resolveDictionariesRouteContext(req: Request): Promise<DictionariesRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('dictionaries.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('dictionaries.errors.organization_required', 'Organization context is required') })
  }

  const em = container.resolve<EntityManager>('em')
  const readableOrganizationIds = new Set<string>()
  readableOrganizationIds.add(organizationId)
  try {
    const organization = await em.findOne(Organization, {
      id: organizationId,
      tenant: auth.tenantId as any,
      deletedAt: null,
    } as any)
    const ancestors = organization && Array.isArray(organization.ancestorIds) ? organization.ancestorIds : []
    for (const ancestorId of ancestors) {
      if (typeof ancestorId === 'string' && ancestorId.trim()) {
        readableOrganizationIds.add(ancestorId)
      }
    }
  } catch (err) {
    console.warn('[dictionaries.resolveContext] Failed to resolve ancestor organizations', err)
  }

  const ctx: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return {
    container,
    ctx,
    auth,
    em,
    organizationId,
    tenantId: auth.tenantId,
    readableOrganizationIds: Array.from(readableOrganizationIds),
    translate,
  }
}
