import { buildAuthorizationUrl } from '@open-mercato/core/modules/integrations/lib/oauth/authorization'
import { createPkcePair } from '@open-mercato/core/modules/integrations/lib/oauth/pkce'
import { XERO_ENDPOINTS, XERO_INTEGRATION_ID, XERO_SCOPES } from '../lib/constants'
import { createXeroDescriptor } from '../lib/descriptor'
import { resolveXeroEndpoints } from '../lib/endpoints'
import { buildXeroGrantOwner } from '../lib/owner'
import { parseXeroProviderData } from '../lib/provider-data'
import { integration } from '../integration'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

describe('Xero descriptor', () => {
  it('builds an authorization URL the core accepts, with the three scopes and PKCE', () => {
    const descriptor = createXeroDescriptor(XERO_ENDPOINTS)
    const { codeChallenge } = createPkcePair()
    const url = new URL(
      buildAuthorizationUrl(descriptor, {
        clientId: 'client-1',
        redirectUri: 'http://localhost:3000/api/sync_xero/oauth/callback',
        state: 'state-1',
        codeChallenge,
      }),
    )

    expect(`${url.origin}${url.pathname}`).toBe('https://login.xero.com/identity/connect/authorize')
    expect(url.searchParams.get('scope')).toBe('offline_access accounting.contacts.read accounting.invoices.read')
    expect(url.searchParams.get('code_challenge')).toBe(codeChallenge)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('response_type')).toBe('code')
  })

  it('declares Xero endpoints, basic client auth and the 30-minute token lifetime', () => {
    expect(createXeroDescriptor(XERO_ENDPOINTS)).toEqual({
      integrationId: 'sync_xero',
      authorizationEndpoint: 'https://login.xero.com/identity/connect/authorize',
      tokenEndpoint: 'https://identity.xero.com/connect/token',
      revocationEndpoint: 'https://identity.xero.com/connect/revocation',
      clientAuthMethod: 'client_secret_basic',
      pkce: 'S256',
      defaultScopes: [...XERO_SCOPES],
      defaultAccessTokenTtlSec: 1800,
    })
  })

  it('omits the revocation endpoint when none is given', () => {
    const descriptor = createXeroDescriptor({ authorize: XERO_ENDPOINTS.authorize, token: XERO_ENDPOINTS.token })
    expect(descriptor).not.toHaveProperty('revocationEndpoint')
  })

  it('builds a tenant-level grant owner', () => {
    expect(buildXeroGrantOwner(scope)).toEqual({ integrationId: 'sync_xero', tenantId: 'tenant-1', organizationId: 'org-1', userId: null })
  })
})

describe('resolveXeroEndpoints', () => {
  it("returns Xero's endpoints", async () => {
    const credentialsService = { resolve: jest.fn(async () => null) }
    await expect(resolveXeroEndpoints({ scope, credentialsService })).resolves.toEqual({
      authorize: 'https://login.xero.com/identity/connect/authorize',
      token: 'https://identity.xero.com/connect/token',
      revoke: 'https://identity.xero.com/connect/revocation',
      connections: 'https://api.xero.com/connections',
      accounting: 'https://api.xero.com/api.xro/2.0',
    })
  })
})

describe('Xero provider data', () => {
  it('accepts a selected Organisation and rejects an empty selection', () => {
    const value = {
      xeroOrganisationId: '996096ec-5362-40dd-be90-3e6a2be09dce',
      xeroConnectionId: '6a3b2c1d-0000-4000-8000-000000000001',
      xeroOrganisationName: 'Demo Company (Global)',
    }
    expect(parseXeroProviderData(value)).toEqual(value)
    expect(parseXeroProviderData({})).toBeNull()
    expect(parseXeroProviderData(null)).toBeNull()
  })
})

describe('Xero integration definition', () => {
  it('does not use the reserved grant suffix', () => {
    expect(XERO_INTEGRATION_ID.endsWith('__oauth_grant')).toBe(false)
    expect(integration.id).toBe(XERO_INTEGRATION_ID)
  })

  it('links an external id to the Xero contact, for company and address mappings', () => {
    const org = '996096ec-5362-40dd-be90-3e6a2be09dce'
    const contact = 'a1b2c3d4-0000-4000-8000-00000000abcd'
    expect(integration.buildExternalUrl?.(`${org}:${contact}`)).toBe(`https://go.xero.com/Contacts/View/${contact}`)
    expect(integration.buildExternalUrl?.(`${org}:${contact}:STREET`)).toBe(`https://go.xero.com/Contacts/View/${contact}`)
  })

  it('stores only a Client ID and a secret Client Secret', () => {
    expect(integration.credentials?.fields.map((field) => [field.key, field.type, field.required])).toEqual([
      ['clientId', 'text', true],
      ['clientSecret', 'secret', true],
    ])
    expect(integration.defaultState).toBeUndefined()
  })
})
