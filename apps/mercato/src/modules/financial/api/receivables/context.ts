import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { ArScope } from '../../lib/arService'

export type ArContext = {
  em: EntityManager
  scope: ArScope
}

export async function resolveArContext(req: Request): Promise<ArContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth?.tenantId) {
    throw new CrudHttpError(401, { error: translate('errors.unauthorized', 'Unauthorized') })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = organizationScope?.selectedId ?? auth.orgId ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('errors.organization_required', 'Organization context is required'),
    })
  }
  return {
    em: (container.resolve('em') as EntityManager).fork(),
    scope: { tenantId: auth.tenantId, organizationId },
  }
}
