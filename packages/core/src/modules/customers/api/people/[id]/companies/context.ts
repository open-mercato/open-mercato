import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  CustomerEntity,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export async function loadPersonContext(req: Request, personId: string) {
  const { translate } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) {
    throw new CrudHttpError(401, { error: translate('customers.errors.unauthorized', 'Unauthorized') })
  }
  const authenticatedAuth = auth as typeof auth & { tenantId: string }

  const container = await createRequestContainer()
  const scope = await resolveOrganizationScopeForRequest({ container, auth: authenticatedAuth, request: req })
  const em = (container.resolve('em') as EntityManager).fork()
  const person = await em.findOne(CustomerEntity, { id: personId, kind: 'person', deletedAt: null })

  if (!person || person.tenantId !== authenticatedAuth.tenantId) {
    throw new CrudHttpError(404, { error: translate('customers.errors.person_not_found', 'Person not found') })
  }

  const allowedOrgIds = new Set<string>()
  if (scope?.filterIds?.length) scope.filterIds.forEach((entry) => allowedOrgIds.add(entry))
  else if (authenticatedAuth.orgId) allowedOrgIds.add(authenticatedAuth.orgId)

  if (allowedOrgIds.size > 0 && !allowedOrgIds.has(person.organizationId)) {
    throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
  }

  const profile = await em.findOne(CustomerPersonProfile, { entity: person }, { populate: ['company'] })
  if (!profile) {
    throw new CrudHttpError(404, { error: translate('customers.errors.person_profile_not_found', 'Person profile not found') })
  }

  return {
    container,
    auth: authenticatedAuth,
    selectedOrganizationId: scope?.selectedId ?? authenticatedAuth.orgId ?? null,
    em,
    person,
    profile,
  }
}
