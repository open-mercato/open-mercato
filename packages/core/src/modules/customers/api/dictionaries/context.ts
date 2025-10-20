import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'

export const dictionaryKindSchema = z.enum(['statuses', 'sources', 'lifecycle-stages', 'address-types', 'job-titles'])

export type DictionaryRouteParam = z.infer<typeof dictionaryKindSchema>
export type DictionaryEntityKind = 'status' | 'source' | 'lifecycle_stage' | 'address_type' | 'job_title'

const KIND_MAP: Record<DictionaryRouteParam, DictionaryEntityKind> = {
  statuses: 'status',
  sources: 'source',
  'lifecycle-stages': 'lifecycle_stage',
  'address-types': 'address_type',
  'job-titles': 'job_title',
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

  const em = container.resolve<EntityManager>('em')
  return {
    auth,
    translate,
    em,
    organizationId,
    tenantId: auth.tenantId,
  }
}
