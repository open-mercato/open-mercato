import type { EntityManager } from '@mikro-orm/postgresql'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CredentialsService } from '@open-mercato/core/modules/integrations/lib/credentials-service'
import type { OAuthGrantOwner, OAuthProviderDescriptor } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import type { IntegrationOAuthGrantService, OAuthGrantInspection } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { createXeroApiClient, type XeroApiClient } from './api-client'
import type { XeroEndpoints } from './constants'
import { createXeroDescriptor } from './descriptor'
import { resolveXeroEndpoints } from './endpoints'
import {
  countXeroMappingsByOrganisation,
  determinePreviousOrganisations,
  readXeroCursorOrganisations,
  type XeroPreviousOrganisation,
} from './organisation'
import { buildXeroGrantOwner, type XeroScope } from './owner'

export type XeroRouteGrant = {
  credentialsService: CredentialsService
  grantService: IntegrationOAuthGrantService
  endpoints: XeroEndpoints
  descriptor: OAuthProviderDescriptor
  owner: OAuthGrantOwner
  em: EntityManager
}

export async function resolveXeroRouteGrant(container: AppContainer, scope: XeroScope): Promise<XeroRouteGrant> {
  const credentialsService = container.resolve<CredentialsService>('integrationCredentialsService')
  const endpoints = await resolveXeroEndpoints({ scope, credentialsService })
  return {
    credentialsService,
    grantService: container.resolve<IntegrationOAuthGrantService>('integrationOAuthGrantService'),
    endpoints,
    descriptor: createXeroDescriptor(endpoints),
    owner: buildXeroGrantOwner(scope),
    em: container.resolve<EntityManager>('em'),
  }
}

export function createInteractiveXeroClient(grant: XeroRouteGrant): XeroApiClient {
  return createXeroApiClient({
    grantService: grant.grantService,
    descriptor: grant.descriptor,
    owner: grant.owner,
    endpoints: grant.endpoints,
    budget: 'interactive',
  })
}

export function grantSelection(inspection: OAuthGrantInspection): {
  providerData: Record<string, unknown> | null
  previousProviderData: Record<string, unknown> | null
} {
  if (inspection.status === 'active' || inspection.status === 'invalidated') {
    return { providerData: inspection.providerData, previousProviderData: inspection.previousProviderData }
  }
  return { providerData: null, previousProviderData: null }
}

export async function loadPreviousOrganisations(
  grant: XeroRouteGrant,
  scope: XeroScope,
  inspection: OAuthGrantInspection,
): Promise<XeroPreviousOrganisation[]> {
  return determinePreviousOrganisations({
    ...grantSelection(inspection),
    counts: await countXeroMappingsByOrganisation(grant.em, scope),
    cursorOrganisationIds: await readXeroCursorOrganisations(grant.em, scope),
  })
}
