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
  organizationId: string | null
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
  const em = (container.resolve('em') as EntityManager)
  const tenantId: string = scope?.tenantId ?? auth.tenantId
  const organizationId = scope?.selectedId ?? auth.orgId ?? null

  const normalizeId = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  const candidateIds = new Set<string>()
  const pushCandidate = (value: unknown) => {
    const normalized = normalizeId(value)
    if (normalized) candidateIds.add(normalized)
  }

  pushCandidate(organizationId)
  if (Array.isArray(scope?.filterIds)) {
    for (const id of scope.filterIds) pushCandidate(id)
  }
  if (Array.isArray(scope?.allowedIds)) {
    for (const id of scope.allowedIds) pushCandidate(id)
  }
  pushCandidate(auth.orgId ?? null)

  const readableOrganizationIds = new Set<string>()
  try {
    const shouldLoadAll = candidateIds.size === 0
    const organizations = await em.find(
      Organization,
      {
        tenant: tenantId as any,
        deletedAt: null,
        ...(shouldLoadAll ? {} : { id: { $in: Array.from(candidateIds) } }),
      } as any,
      { fields: ['id', 'ancestorIds'] },
    )
    for (const organization of organizations) {
      const id = normalizeId(organization.id)
      if (id) readableOrganizationIds.add(id)
      if (Array.isArray(organization.ancestorIds)) {
        for (const ancestorId of organization.ancestorIds) {
          const normalized = normalizeId(ancestorId)
          if (normalized) readableOrganizationIds.add(normalized)
        }
      }
    }
    if (!shouldLoadAll && readableOrganizationIds.size === 0) {
      for (const id of candidateIds) readableOrganizationIds.add(id)
    }
  } catch (err) {
    console.warn('[dictionaries.resolveContext] Failed to resolve readable organizations', err)
    for (const id of candidateIds) readableOrganizationIds.add(id)
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
    tenantId,
    readableOrganizationIds: Array.from(readableOrganizationIds),
    translate,
  }
}
