import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer, type AppContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CacheStrategy } from '@open-mercato/cache'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'

export const dictionaryKindSchema = z.enum([
  'statuses',
  'sources',
  'lifecycle-stages',
  'address-types',
  'activity-types',
  'deal-statuses',
  'pipeline-stages',
  'job-titles',
  'industries',
])

export type DictionaryRouteParam = z.infer<typeof dictionaryKindSchema>
export type DictionaryEntityKind =
  | 'status'
  | 'source'
  | 'lifecycle_stage'
  | 'address_type'
  | 'activity_type'
  | 'deal_status'
  | 'pipeline_stage'
  | 'job_title'
  | 'industry'

const KIND_MAP: Record<DictionaryRouteParam, DictionaryEntityKind> = {
  statuses: 'status',
  sources: 'source',
  'lifecycle-stages': 'lifecycle_stage',
  'address-types': 'address_type',
  'activity-types': 'activity_type',
  'deal-statuses': 'deal_status',
  'pipeline-stages': 'pipeline_stage',
  'job-titles': 'job_title',
  industries: 'industry',
}

export const paramsSchema = z.object({
  kind: dictionaryKindSchema,
})

export type DictionaryRouteContext = {
  auth: Awaited<ReturnType<typeof getAuthFromRequest>>
  translate: (key: string, fallback?: string) => string
  em: EntityManager
  organizationId: string | null
  tenantId: string
  readableOrganizationIds: string[]
  cache?: CacheStrategy
  container: AppContainer
  ctx: CommandRuntimeContext
}

export function mapDictionaryKind(kind: string | undefined) {
  const parsed = paramsSchema.parse({ kind })
  return {
    kind: parsed.kind,
    mappedKind: KIND_MAP[parsed.kind],
  }
}

export async function resolveDictionaryRouteContext(req: Request): Promise<DictionaryRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  }

  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const em = (container.resolve('em') as EntityManager)
  const tenantId = scope?.tenantId ?? auth.tenantId
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
  pushCandidate(auth.orgId ?? null)
  if (Array.isArray(scope?.filterIds)) {
    for (const id of scope.filterIds) pushCandidate(id)
  }
  if (Array.isArray(scope?.allowedIds)) {
    for (const id of scope.allowedIds) pushCandidate(id)
  }

  let cache: CacheStrategy | undefined
  try {
    cache = (container.resolve('cache') as CacheStrategy)
  } catch {}

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
    console.warn('[customers.dictionaries.context] Failed to resolve ancestor organizations', err)
    for (const id of candidateIds) readableOrganizationIds.add(id)
  }

  const commandContext: CommandRuntimeContext = {
    container,
    auth,
    organizationScope: scope,
    selectedOrganizationId: organizationId,
    organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
    request: req,
  }

  return {
    auth,
    translate,
    em,
    organizationId,
    tenantId,
    readableOrganizationIds: Array.from(readableOrganizationIds),
    cache,
    container,
    ctx: commandContext,
  }
}
