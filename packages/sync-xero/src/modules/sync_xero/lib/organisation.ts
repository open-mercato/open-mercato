import type { EntityManager } from '@mikro-orm/postgresql'
import { SyncCursor } from '@open-mercato/core/modules/data_sync/data/entities'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import type { OAuthGrantOwner, OAuthProviderDescriptor } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import type { IntegrationOAuthGrantService, OAuthConnectResult } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import type { RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { XeroApiClient } from './api-client'
import { listConsentOrganisations, type XeroOrganisationOption } from './connections'
import { XERO_INTEGRATION_ID } from './constants'
import type { XeroScope } from './owner'
import { parseXeroProviderData, xeroProviderDataSchema, type XeroProviderData } from './provider-data'

export function toXeroProviderData(option: XeroOrganisationOption): XeroProviderData {
  return xeroProviderDataSchema.parse({
    xeroOrganisationId: option.xeroOrganisationId,
    xeroConnectionId: option.xeroConnectionId,
    xeroOrganisationName: option.name.slice(0, 255),
  })
}

export async function hasXeroSyncHistory(em: EntityManager, scope: XeroScope): Promise<boolean> {
  const mappings = await em.count(SyncExternalIdMapping, {
    integrationId: XERO_INTEGRATION_ID,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  if (mappings > 0) return true
  const cursors = await em.count(SyncCursor, {
    integrationId: XERO_INTEGRATION_ID,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    cursor: { $ne: null },
  })
  return cursors > 0
}

/**
 * App Spec WF1: save automatically only one Organisation, and only when it is the previous one or,
 * without a previous one, when the organization has no Xero mapping or cursor yet.
 */
export function pickAutomaticOrganisation(input: {
  organisations: XeroOrganisationOption[]
  previousOrganisationId: string | null
  hasSyncHistory: boolean
}): XeroOrganisationOption | null {
  if (input.organisations.length !== 1) return null
  const [only] = input.organisations
  if (input.previousOrganisationId) return only.xeroOrganisationId === input.previousOrganisationId ? only : null
  return input.hasSyncHistory ? null : only
}

export type AutoSelectOrganisationInput = {
  client: Pick<XeroApiClient, 'getToken' | 'listConnections'>
  grantService: Pick<IntegrationOAuthGrantService, 'updateProviderData'>
  descriptor: OAuthProviderDescriptor
  owner: OAuthGrantOwner
  connect: Pick<OAuthConnectResult, 'revisedAt' | 'previousProviderData'>
  hasSyncHistory: () => Promise<boolean>
  runGuard: (providerData: XeroProviderData) => Promise<RouteMutationGuardResult>
  actorUserId: string
  afterSave?: (providerData: XeroProviderData) => Promise<void>
  reportFailure: (error: unknown) => void
}

export type AutoSelectOrganisationOutcome = 'connected' | 'account_pending'

/** Never throws: any failure leaves the grant's External Account pending for the Xero tab. */
export async function autoSelectOrganisation(input: AutoSelectOrganisationInput): Promise<AutoSelectOrganisationOutcome> {
  try {
    const { organisations } = await listConsentOrganisations(input.client)
    const previousOrganisationId = parseXeroProviderData(input.connect.previousProviderData)?.xeroOrganisationId ?? null
    const choice = pickAutomaticOrganisation({
      organisations,
      previousOrganisationId,
      hasSyncHistory: previousOrganisationId === null && organisations.length === 1 ? await input.hasSyncHistory() : false,
    })
    if (!choice) return 'account_pending'
    const providerData = toXeroProviderData(choice)
    const guard = await input.runGuard(providerData)
    if (!guard.ok) return 'account_pending'
    await input.grantService.updateProviderData(input.descriptor, input.owner, providerData, {
      expectedRevisedAt: input.connect.revisedAt,
      actorUserId: input.actorUserId,
    })
    await guard.runAfterSuccess()
    if (input.afterSave) {
      try {
        await input.afterSave(providerData)
      } catch (error) {
        input.reportFailure(error)
      }
    }
    return 'connected'
  } catch (error) {
    input.reportFailure(error)
    return 'account_pending'
  }
}
