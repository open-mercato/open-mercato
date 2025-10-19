import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'

export type DictionariesRouteContext = {
  em: EntityManager
  organizationId: string
  tenantId: string
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
  return {
    em,
    organizationId,
    tenantId: auth.tenantId,
    translate,
  }
}

