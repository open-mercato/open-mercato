import type { EntityManager } from '@mikro-orm/postgresql'
import { SyncCursor } from '@open-mercato/core/modules/data_sync/data/entities'
import { SyncExternalIdMapping } from '@open-mercato/core/modules/integrations/data/entities'
import type { OAuthGrantOwner, OAuthProviderDescriptor } from '@open-mercato/core/modules/integrations/lib/oauth/descriptor'
import type { IntegrationOAuthGrantService, OAuthConnectResult } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import type { RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { XeroApiClient } from './api-client'
import { listConsentOrganisations, type XeroOrganisationOption } from './connections'
import { XERO_COMPANY_MAPPING_TYPE, XERO_INTEGRATION_ID, XERO_INVOICE_MAPPING_TYPE } from './constants'
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

export type XeroMappingCounts = { companyCount: number; invoiceCount: number }

export type XeroPreviousOrganisation = {
  xeroOrganisationId: string
  name: string | null
} & XeroMappingCounts

type MappingCountRow = { prefix: string | null; entity_type: string; total: number | string }

export async function countXeroMappingsByOrganisation(em: EntityManager, scope: XeroScope): Promise<Map<string, XeroMappingCounts>> {
  const rows = await em.getConnection().execute<MappingCountRow[]>(
    `SELECT split_part(external_id, ':', 1) AS prefix, internal_entity_type AS entity_type, count(*) AS total
       FROM sync_external_id_mappings
      WHERE integration_id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL
        AND internal_entity_type IN (?, ?)
      GROUP BY 1, 2`,
    [XERO_INTEGRATION_ID, scope.tenantId, scope.organizationId, XERO_COMPANY_MAPPING_TYPE, XERO_INVOICE_MAPPING_TYPE],
  )
  const counts = new Map<string, XeroMappingCounts>()
  for (const row of rows) {
    if (!row.prefix) continue
    const entry = counts.get(row.prefix) ?? { companyCount: 0, invoiceCount: 0 }
    const total = Number(row.total)
    if (row.entity_type === XERO_COMPANY_MAPPING_TYPE) entry.companyCount += total
    else entry.invoiceCount += total
    counts.set(row.prefix, entry)
  }
  return counts
}

function readCursorOrganisationId(raw: string | null | undefined): string | null {
  if (!raw) return null
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object') return null
    const organisationId = (value as Record<string, unknown>).xeroOrganisationId
    return typeof organisationId === 'string' && organisationId.trim().length > 0 ? organisationId.trim() : null
  } catch {
    return null
  }
}

/** The Xero Organisations the organization's `sync_xero` cursors carry. */
export async function readXeroCursorOrganisations(em: EntityManager, scope: XeroScope): Promise<string[]> {
  const rows = await findWithDecryption(
    em,
    SyncCursor,
    { integrationId: XERO_INTEGRATION_ID, tenantId: scope.tenantId, organizationId: scope.organizationId },
    undefined,
    scope,
  )
  const ids = new Set<string>()
  for (const row of rows) {
    const organisationId = readCursorOrganisationId(row.cursor)
    if (organisationId) ids.add(organisationId)
  }
  return [...ids]
}

/**
 * The previous Organisations of an organization (App Spec § 10 #15, core rule 11): the grant's
 * current selection, else its previous selection, else every distinct Organisation that the
 * organization's mapping prefixes and cursors refer to.
 */
export function determinePreviousOrganisations(input: {
  providerData: Record<string, unknown> | null
  previousProviderData: Record<string, unknown> | null
  counts: Map<string, XeroMappingCounts>
  cursorOrganisationIds?: string[]
}): XeroPreviousOrganisation[] {
  const withCounts = (xeroOrganisationId: string, name: string | null): XeroPreviousOrganisation => ({
    xeroOrganisationId,
    name,
    ...(input.counts.get(xeroOrganisationId) ?? { companyCount: 0, invoiceCount: 0 }),
  })
  const selected = parseXeroProviderData(input.providerData) ?? parseXeroProviderData(input.previousProviderData)
  if (selected) return [withCounts(selected.xeroOrganisationId, selected.xeroOrganisationName)]
  const known = new Set([...input.counts.keys(), ...(input.cursorOrganisationIds ?? [])])
  return [...known]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .map((organisationId) => withCounts(organisationId, null))
}

export type OrganisationChangeDecision =
  | { kind: 'unchanged' }
  | { kind: 'blocked'; previous: XeroPreviousOrganisation[] }
  | { kind: 'confirm'; previous: XeroPreviousOrganisation[] }

/** App Spec § 10 #2 and #20: a different Organisation needs a confirmation, and invoices mapped under a previous one block it. */
export function decideOrganisationChange(xeroOrganisationId: string, previous: XeroPreviousOrganisation[]): OrganisationChangeDecision {
  const others = previous.filter((entry) => entry.xeroOrganisationId !== xeroOrganisationId)
  if (others.length === 0) return { kind: 'unchanged' }
  const withInvoices = others.filter((entry) => entry.invoiceCount > 0)
  if (withInvoices.length > 0) return { kind: 'blocked', previous: withInvoices }
  return { kind: 'confirm', previous: others }
}
