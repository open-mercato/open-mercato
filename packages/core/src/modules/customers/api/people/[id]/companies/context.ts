import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  CustomerEntity,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isOrganizationReadAccessAllowed } from '@open-mercato/core/modules/directory/utils/organizationScopeGuard'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'

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
  const decryptionScope = {
    tenantId: authenticatedAuth.tenantId,
    organizationId: scope?.selectedId ?? authenticatedAuth.orgId ?? null,
  }
  const person = await findOneWithDecryption(
    em,
    CustomerEntity,
    { id: personId, kind: 'person', tenantId: authenticatedAuth.tenantId, deletedAt: null },
    {},
    decryptionScope,
  )

  if (!person) {
    throw notFound(translate('customers.errors.person_not_found', 'Person not found'))
  }

  if (!isOrganizationReadAccessAllowed({ scope, auth: authenticatedAuth, organizationId: person.organizationId })) {
    throw new CrudHttpError(403, { error: translate('customers.errors.access_denied', 'Access denied') })
  }

  const profile = await findOneWithDecryption(
    em,
    CustomerPersonProfile,
    { entity: person, tenantId: person.tenantId, organizationId: person.organizationId },
    { populate: ['company'] },
    {
      tenantId: person.tenantId,
      organizationId: person.organizationId,
    },
  )
  if (!profile) {
    throw notFound(translate('customers.errors.person_profile_not_found', 'Person profile not found'))
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
