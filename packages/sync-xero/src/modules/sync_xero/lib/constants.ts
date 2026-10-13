export const XERO_INTEGRATION_ID = 'sync_xero'
export const XERO_PROVIDER_KEY = 'xero'
export const XERO_CONTACTS_ENTITY_TYPE = 'xero.contacts'
export const XERO_SUPPORTED_ENTITY_TYPES = [XERO_CONTACTS_ENTITY_TYPE] as const

export const XERO_SCOPES = ['offline_access', 'accounting.contacts.read', 'accounting.invoices.read'] as const
export const XERO_ACCESS_TOKEN_TTL_SEC = 1800

export const XERO_CALLBACK_PATH = '/api/sync_xero/oauth/callback'
export const XERO_CONNECT_TAB_ID = 'xero'
export const XERO_TAB_PATH = '/backend/integrations/sync_xero'
export const XERO_STATE_COOKIE = 'om_xero_oauth_state'

export type XeroEndpoints = {
  authorize: string
  token: string
  revoke?: string
  connections: string
  accounting: string
}

export const XERO_ENDPOINTS: Readonly<Required<XeroEndpoints>> = Object.freeze({
  authorize: 'https://login.xero.com/identity/connect/authorize',
  token: 'https://identity.xero.com/connect/token',
  revoke: 'https://identity.xero.com/connect/revocation',
  connections: 'https://api.xero.com/connections',
  accounting: 'https://api.xero.com/api.xro/2.0',
})

export const XERO_CONTACT_URL_BASE = 'https://go.xero.com/Contacts/View/'
