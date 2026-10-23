import type { OAuthGrantInspection } from '@open-mercato/core/modules/integrations/lib/oauth/grant-service'
import { parseXeroProviderData } from './provider-data'

export const XERO_REFRESH_TOKEN_IDLE_DAYS = 60
const DAY_MS = 24 * 60 * 60 * 1000

export type XeroOrganisationRef = { id: string; name: string }

export type XeroGrantView = {
  status: OAuthGrantInspection['status']
  connectionState: OAuthGrantInspection['connectionState']
  unavailableReason: OAuthGrantInspection['unavailableReason']
  organisation: XeroOrganisationRef | null
  previousOrganisation: XeroOrganisationRef | null
  revisedAt: string | null
  refreshedAt: string | null
  obtainedAt: string | null
  refreshExpiresInDays: number | null
  clientChanged: boolean
  missingScopes: string[]
  lastDisconnect: { at: string; disconnectId: string; revocation: string } | null
}

function toOrganisationRef(value: Record<string, unknown> | null): XeroOrganisationRef | null {
  const parsed = parseXeroProviderData(value)
  return parsed ? { id: parsed.xeroOrganisationId, name: parsed.xeroOrganisationName } : null
}

export function refreshExpiresInDays(lastUse: Date, now: Date): number {
  return XERO_REFRESH_TOKEN_IDLE_DAYS - Math.floor((now.getTime() - lastUse.getTime()) / DAY_MS)
}

/** Builds the tab's view of a grant; it copies named fields only, so the inspection's access token never leaves. */
export function toXeroGrantView(inspection: OAuthGrantInspection, now: Date): XeroGrantView {
  if (inspection.status === 'none' || inspection.status === 'unavailable') {
    const lastDisconnect = inspection.status === 'none' ? inspection.lastDisconnect : null
    return {
      status: inspection.status,
      connectionState: inspection.connectionState,
      unavailableReason: inspection.unavailableReason,
      organisation: null,
      previousOrganisation: null,
      revisedAt: null,
      refreshedAt: null,
      obtainedAt: null,
      refreshExpiresInDays: null,
      clientChanged: false,
      missingScopes: [],
      lastDisconnect: lastDisconnect
        ? { at: lastDisconnect.at.toISOString(), disconnectId: lastDisconnect.disconnectId, revocation: lastDisconnect.revocation }
        : null,
    }
  }
  return {
    status: inspection.status,
    connectionState: inspection.connectionState,
    unavailableReason: inspection.unavailableReason,
    organisation: toOrganisationRef(inspection.providerData),
    previousOrganisation: toOrganisationRef(inspection.previousProviderData),
    revisedAt: inspection.revisedAt.toISOString(),
    refreshedAt: inspection.refreshedAt ? inspection.refreshedAt.toISOString() : null,
    obtainedAt: inspection.obtainedAt.toISOString(),
    refreshExpiresInDays: refreshExpiresInDays(inspection.refreshedAt ?? inspection.obtainedAt, now),
    clientChanged: inspection.clientChanged,
    missingScopes: [...inspection.missingScopes],
    lastDisconnect: null,
  }
}
