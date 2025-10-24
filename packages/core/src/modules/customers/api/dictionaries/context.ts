import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { Organization } from '@open-mercato/core/modules/directory/data/entities'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { CacheStrategy } from '@open-mercato/cache'

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
  organizationId: string
  tenantId: string
  readableOrganizationIds: string[]
  cache?: CacheStrategy
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
  const organizationId = scope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('customers.errors.organization_required', 'Organization context is required') })
  }

  let cache: CacheStrategy | undefined
  try {
    cache = container.resolve<CacheStrategy>('cache')
  } catch {}

  const em = container.resolve<EntityManager>('em')
  const readableOrganizationIds: string[] = [organizationId]
  try {
    const organization = await em.findOne(Organization, {
      id: organizationId,
      tenant: auth.tenantId as any,
      deletedAt: null,
    } as any)
    if (organization && Array.isArray(organization.ancestorIds)) {
      for (const ancestorId of organization.ancestorIds) {
        if (typeof ancestorId === 'string' && ancestorId.trim()) {
          readableOrganizationIds.push(ancestorId)
        }
      }
    }
  } catch (err) {
    console.warn('[customers.dictionaries.context] Failed to resolve ancestor organizations', err)
  }

  return {
    auth,
    translate,
    em,
    organizationId,
    tenantId: auth.tenantId,
    readableOrganizationIds,
    cache,
  }
}
