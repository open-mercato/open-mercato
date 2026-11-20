import { XERO_CONTACT_URL_BASE } from './constants'

export type XeroAddressType = 'POBOX' | 'STREET'

export function formatContactExternalId(xeroOrganisationId: string, contactId: string): string {
  return `${xeroOrganisationId}:${contactId}`
}

export function formatAddressExternalId(xeroOrganisationId: string, contactId: string, addressType: XeroAddressType): string {
  return `${xeroOrganisationId}:${contactId}:${addressType}`
}

export function readContactIdFromExternalId(externalId: string): string | null {
  const segments = externalId.split(':')
  if (segments.length < 2) return null
  const contactId = segments[1].trim()
  return contactId.length > 0 ? contactId : null
}

export function readOrganisationIdFromExternalId(externalId: string): string | null {
  const segments = externalId.split(':')
  if (segments.length < 2) return null
  const organisationId = segments[0].trim()
  return organisationId.length > 0 ? organisationId : null
}

export function buildXeroContactUrl(externalId: string): string {
  const contactId = readContactIdFromExternalId(externalId)
  return contactId ? `${XERO_CONTACT_URL_BASE}${encodeURIComponent(contactId)}` : XERO_CONTACT_URL_BASE
}
