import type { XeroGrantView } from '../../../lib/connection-status'

export type XeroConnectionView = {
  redirectUri: string | null
  baseUrlMissing: boolean
  configured: boolean
  canManage: boolean
  seamActive: boolean
  grant: XeroGrantView
}

export type XeroOrganisationChoice = {
  xeroOrganisationId: string
  xeroConnectionId: string
  name: string
}

export type XeroPreviousOrganisationView = {
  xeroOrganisationId: string
  name: string | null
  companyCount?: number
  invoiceCount?: number
}

export type XeroOrganisationsView = {
  organisations: XeroOrganisationChoice[]
  filtered: boolean
  selected: string | null
  previous: XeroPreviousOrganisationView[]
}

export type XeroTabContext = {
  integrationId?: string
  integrationDetailWidgetSpotId?: string
  state?: { isEnabled?: boolean } | null
  setActiveTab?: (tabId: string) => void
  refreshDetail?: () => Promise<void>
}

export type XeroHttpError = Error & {
  status?: number
  code?: string
  next?: XeroPreviousOrganisationView
  previous?: XeroPreviousOrganisationView[]
}

export function asXeroHttpError(error: unknown): XeroHttpError | null {
  return error instanceof Error ? (error as XeroHttpError) : null
}
