import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import {
  CustomerEntity,
  CustomerPersonProfile,
} from '@open-mercato/core/modules/customers/data/entities'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { isExplicitlyEmptyOrganizationScope } from '@open-mercato/shared/lib/auth/organizationScope'
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
  // An explicitly empty organization scope is deny-all: the caller can see no
  // organization, so every person is not-found. Answering 404 here (rather than
  // letting the scope resolver throw a 403) keeps the #5504 existence-oracle
  // collapse intact — a foreign-org id and a non-existent id stay identical.
  if (isExplicitlyEmptyOrganizationScope(scope)) {
    throw notFound(translate('customers.errors.person_not_found', 'Person not found'))
  }
  const em = (container.resolve('em') as EntityManager).fork()
  const selectedOrganizationId = scope?.selectedId ?? authenticatedAuth.orgId ?? null
  const decryptionScope = {
    tenantId: authenticatedAuth.tenantId,
    organizationId: selectedOrganizationId,
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

  // Existence oracle (#5504): deny a cross-org read as not-found — identical to
  // the parent-not-found above — so it cannot reveal that a person exists in an
  // organization the caller cannot see.
  if (!isOrganizationReadAccessAllowed({ scope, auth: authenticatedAuth, organizationId: person.organizationId })) {
    throw notFound(translate('customers.errors.person_not_found', 'Person not found'))
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
    selectedOrganizationId,
    em,
    person,
    profile,
  }
}
