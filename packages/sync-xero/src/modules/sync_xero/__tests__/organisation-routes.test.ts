/** @jest-environment node */
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { createFakeContainer } from './support/fakeContainer'
import { startStubHttpServer, type StubHttpServer, type StubResponse } from './support/stubHttpServer'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockResolveEndpoints = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScope(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({ translate: (_key: string, fallback: string) => fallback }),
}))

const mockFindWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  ...jest.requireActual('@open-mercato/shared/lib/encryption/find'),
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../lib/endpoints', () => ({
  resolveXeroEndpoints: (...args: unknown[]) => mockResolveEndpoints(...args),
}))

import { GET as getConnection, metadata as connectionMetadata } from '../api/get/connection/route'
import { GET as getOrganisations } from '../api/get/organisations/route'
import { PUT as putOrganisation } from '../api/put/organisation/route'

const APP_ORIGIN = 'http://localhost:3000'
const USER_ID = 'user-1'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const XERO_ORG_A = '996096ec-5362-40dd-be90-3e6a2be09dce'
const XERO_ORG_B = '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6'
const XERO_ORG_C = 'c0c0c0c0-0000-4000-8000-0000000000cc'
const CONN_A = 'a0a0a0a0-0000-4000-8000-00000000000a'
const CONN_B = 'b0b0b0b0-0000-4000-8000-00000000000b'
const CONN_C = 'c1c1c1c1-0000-4000-8000-00000000000c'
const PROVIDER_DATA_A = { xeroOrganisationId: XERO_ORG_A, xeroConnectionId: CONN_A, xeroOrganisationName: 'Demo Company (Global)' }

const connection = (id: string, tenantId: string, tenantName: string, authEventId = 'evt-0') => ({
  id,
  tenantId,
  tenantType: 'ORGANISATION',
  tenantName,
  authEventId,
})

let xeroApi: StubHttpServer
let connectionsHandler: (query: URLSearchParams) => StubResponse
let grants: FakeGrantService
let features: Set<string>
let mappingRows: Array<{ prefix: string; entity_type: string; total: number }>
let cursorRows: Array<{ cursor: string | null }>
const savedEnv = { ...process.env }

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

function buildContainer() {
  return createFakeContainer({
    rbacService: {
      async userHasAllFeatures(_userId: string, required: string[]) {
        return required.every((feature) => features.has(feature))
      },
      async getGrantedFeatures() {
        return [...features]
      },
    },
    integrationCredentialsService: { resolve: async () => ({ clientId: 'client-1', clientSecret: 'secret-1' }) },
    integrationOAuthGrantService: grants.service,
    em: {
      count: async () => 0,
      getConnection: () => ({ execute: async () => mappingRows }),
    },
  })
}

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${APP_ORIGIN}${path}`, init)
}

function putRequest(body: unknown, revisedAt?: string | null): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (revisedAt) headers['x-om-ext-optimistic-lock-expected-updated-at'] = revisedAt
  return request('/api/sync_xero/organisation', { method: 'PUT', headers, body: JSON.stringify(body) })
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>
}

beforeAll(async () => {
  xeroApi = await startStubHttpServer((stubRequest) => (stubRequest.path === '/connections' ? connectionsHandler(stubRequest.query) : { status: 404 }))
})

afterAll(async () => {
  await xeroApi.close()
  registerMutationGuards([])
  process.env = savedEnv
})

beforeEach(() => {
  process.env = { ...savedEnv, NODE_ENV: 'test' }
  delete process.env.APP_URL
  registerMutationGuards([])
  grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA_A })
  features = new Set(['integrations.view', 'integrations.credentials.manage'])
  mappingRows = []
  cursorRows = []
  mockFindWithDecryption.mockReset().mockImplementation(async () => cursorRows)
  connectionsHandler = () => ({ status: 200, body: [connection(CONN_A, XERO_ORG_A, 'Demo Company (Global)')] })
  mockGetAuthFromRequest.mockReset().mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
  mockCreateRequestContainer.mockReset().mockImplementation(async () => buildContainer())
  mockResolveOrganizationScope.mockReset().mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: null, tenantId: TENANT_ID })
  mockResolveEndpoints.mockReset().mockResolvedValue({
    authorize: 'https://login.xero.com/identity/connect/authorize',
    token: 'https://identity.xero.com/connect/token',
    revoke: 'https://identity.xero.com/connect/revocation',
    connections: `${xeroApi.url}/connections`,
    accounting: `${xeroApi.url}/api.xro/2.0`,
  })
})

describe('GET /api/sync_xero/connection', () => {
  it('requires integrations.view', async () => {
    expect(connectionMetadata.GET.requireFeatures).toEqual(['integrations.view'])
    features = new Set()
    expect((await getConnection(request('/api/sync_xero/connection'))).status).toBe(403)
  })

  it('reports an active grant with its Organisation and never returns a token', async () => {
    const response = await getConnection(request('/api/sync_xero/connection'))
    expect(response.status).toBe(200)
    const raw = await response.text()
    expect(raw).not.toContain(grants.state.accessToken as string)
    const body = JSON.parse(raw) as Record<string, unknown>
    expect(body).toMatchObject({
      redirectUri: `${APP_ORIGIN}/api/sync_xero/oauth/callback`,
      baseUrlMissing: false,
      configured: true,
      canManage: true,
      grant: {
        status: 'active',
        connectionState: 'active',
        organisation: { id: XERO_ORG_A, name: 'Demo Company (Global)' },
        previousOrganisation: null,
        refreshExpiresInDays: 60,
        clientChanged: false,
        missingScopes: [],
        lastDisconnect: null,
      },
    })
  })

  it('reports an Account pending grant without an Organisation', async () => {
    grants = createFakeGrantService({ connected: true })
    const body = await json(await getConnection(request('/api/sync_xero/connection')))
    expect(body.grant).toMatchObject({ status: 'active', organisation: null })
  })

  it.each([
    ['not configured', (fake: FakeGrantService) => {
      fake.setStatus('none')
      fake.state.clientConfigured = false
    }, { status: 'none', connectionState: 'not_configured' }, false],
    ['not connected', (fake: FakeGrantService) => fake.setStatus('none'), { status: 'none', connectionState: 'not_connected' }, true],
    ['invalidated', (fake: FakeGrantService) => fake.setStatus('invalidated'), { status: 'invalidated', connectionState: 'invalidated' }, true],
    ['unavailable', (fake: FakeGrantService) => {
      fake.setStatus('unavailable')
      fake.state.unavailableReason = 'unreadable'
    }, { status: 'unavailable', connectionState: 'unavailable', unavailableReason: 'unreadable' }, true],
  ])('reports the %s state', async (_label, arrange, expectedGrant, configured) => {
    arrange(grants)
    const body = await json(await getConnection(request('/api/sync_xero/connection')))
    expect(body.grant).toMatchObject(expectedGrant)
    expect(body.configured).toBe(configured)
  })

  it('counts the keep-alive days from the last refresh, below zero when overdue', async () => {
    grants.state.refreshedAt = new Date(Date.now() - 61 * 24 * 60 * 60 * 1000)
    const body = await json(await getConnection(request('/api/sync_xero/connection')))
    expect((body.grant as Record<string, unknown>).refreshExpiresInDays).toBe(-1)
  })

  it('tells a viewer without integrations.credentials.manage that they cannot manage it', async () => {
    features = new Set(['integrations.view'])
    const body = await json(await getConnection(request('/api/sync_xero/connection')))
    expect(body.canManage).toBe(false)
  })

  it('shows no redirect URI in production without APP_URL', async () => {
    process.env.NODE_ENV = 'production'
    const body = await json(await getConnection(request('/api/sync_xero/connection')))
    expect(body.redirectUri).toBeNull()
  })
})

describe('GET /api/sync_xero/organisations', () => {
  it('lists the consent round filtered by authEventId', async () => {
    grants = createFakeGrantService({ connected: true, tokenFactory: () => jwt({ authentication_event_id: 'evt-9' }) })
    connectionsHandler = (query) => ({
      status: 200,
      body: query.get('authEventId') === 'evt-9'
        ? [connection(CONN_B, XERO_ORG_B, 'Second Ltd', 'evt-9')]
        : [connection(CONN_A, XERO_ORG_A, 'Demo Company (Global)'), connection(CONN_B, XERO_ORG_B, 'Second Ltd', 'evt-9')],
    })
    const body = await json(await getOrganisations(request('/api/sync_xero/organisations')))
    expect(body).toMatchObject({
      organisations: [{ xeroOrganisationId: XERO_ORG_B, xeroConnectionId: CONN_B, name: 'Second Ltd' }],
      filtered: true,
      selected: null,
    })
  })

  it('falls back to every Organisation of the grant when the consent round is empty', async () => {
    grants = createFakeGrantService({ connected: true, providerData: PROVIDER_DATA_A, tokenFactory: () => jwt({ authentication_event_id: 'evt-9' }) })
    connectionsHandler = (query) => ({ status: 200, body: query.get('authEventId') ? [] : [connection(CONN_A, XERO_ORG_A, 'Demo Company (Global)')] })
    mappingRows = [{ prefix: XERO_ORG_A, entity_type: 'customers.company', total: 12 }]
    const body = await json(await getOrganisations(request('/api/sync_xero/organisations')))
    expect(body).toMatchObject({
      filtered: false,
      selected: XERO_ORG_A,
      previous: [{ xeroOrganisationId: XERO_ORG_A, name: 'Demo Company (Global)', companyCount: 12, invoiceCount: 0 }],
    })
  })

  it('lists every Organisation for scope=all without the consent filter', async () => {
    grants = createFakeGrantService({ connected: true, tokenFactory: () => jwt({ authentication_event_id: 'evt-9' }) })
    const before = xeroApi.requests.length
    await getOrganisations(request('/api/sync_xero/organisations?scope=all'))
    const sent = xeroApi.requests.slice(before)
    expect(sent).toHaveLength(1)
    expect(sent[0].query.has('authEventId')).toBe(false)
  })

  it('answers not_connected without a grant', async () => {
    grants.setStatus('none')
    const response = await getOrganisations(request('/api/sync_xero/organisations'))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ code: 'not_connected' })
  })

  it('answers xero.account_unavailable when no token can be obtained', async () => {
    grants.setStatus('invalidated')
    const response = await getOrganisations(request('/api/sync_xero/organisations'))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ code: 'xero.account_unavailable' })
  })

  it.each([
    ['client_misconfigured', 409, 'xero.client_misconfigured'],
    ['transient', 503, 'transient'],
    ['platform_unavailable', 503, 'platform_unavailable'],
    ['grant_invalidated', 409, 'xero.account_unavailable'],
  ] as const)('maps a %s token failure to %i %s, never a reconnect for a client or temporary failure', async (failure, status, code) => {
    grants.failNext('getAccessToken', failure)
    const response = await getOrganisations(request('/api/sync_xero/organisations'))
    expect(response.status).toBe(status)
    expect(await json(response)).toMatchObject({ code })
  })

  it('answers 503 xero.unavailable after one failed Xero call', async () => {
    connectionsHandler = () => ({ status: 500 })
    const before = xeroApi.requests.length
    const response = await getOrganisations(request('/api/sync_xero/organisations'))
    expect(response.status).toBe(503)
    expect(await json(response)).toMatchObject({ code: 'xero.unavailable' })
    expect(xeroApi.requests.length - before).toBe(1)
  })
})

describe('PUT /api/sync_xero/organisation', () => {
  it('saves the previous Organisation again without a confirmation', async () => {
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_A }, grants.state.revisedAt.toISOString()))
    expect(response.status).toBe(200)
    expect(await json(response)).toMatchObject({ organisation: { id: XERO_ORG_A, name: 'Demo Company (Global)' } })
  })

  it('answers the core 409 for a stale revision', async () => {
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_A }, '2020-01-01T00:00:00.000Z'))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ code: 'optimistic_lock_conflict' })
  })

  it('asks to confirm a change and names every previous Organisation of the mappings', async () => {
    grants = createFakeGrantService({ connected: true })
    connectionsHandler = () => ({ status: 200, body: [connection(CONN_C, XERO_ORG_C, 'Third Pty')] })
    mappingRows = [
      { prefix: XERO_ORG_A, entity_type: 'customers.company', total: 4 },
      { prefix: XERO_ORG_B, entity_type: 'customers.company', total: 7 },
    ]
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_C }, grants.state.revisedAt.toISOString()))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({
      code: 'xero.organisation_change_confirmation_required',
      next: { xeroOrganisationId: XERO_ORG_C, name: 'Third Pty' },
      previous: [
        { xeroOrganisationId: XERO_ORG_B, name: null, companyCount: 7 },
        { xeroOrganisationId: XERO_ORG_A, name: null, companyCount: 4 },
      ],
    })
    expect(grants.calls.some((call) => call.method === 'updateProviderData')).toBe(false)

    const confirmed = await putOrganisation(
      putRequest({ xeroOrganisationId: XERO_ORG_C, confirmChange: true }, grants.state.revisedAt.toISOString()),
    )
    expect(confirmed.status).toBe(200)
    expect(grants.state.providerData).toEqual({ xeroOrganisationId: XERO_ORG_C, xeroConnectionId: CONN_C, xeroOrganisationName: 'Third Pty' })
  })

  it('asks to confirm a change away from the current Organisation', async () => {
    connectionsHandler = () => ({ status: 200, body: [connection(CONN_A, XERO_ORG_A, 'Demo Company (Global)'), connection(CONN_B, XERO_ORG_B, 'Second Ltd')] })
    mappingRows = [{ prefix: XERO_ORG_A, entity_type: 'customers.company', total: 3 }]
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_B }, grants.state.revisedAt.toISOString()))
    expect(await json(response)).toMatchObject({
      code: 'xero.organisation_change_confirmation_required',
      previous: [{ xeroOrganisationId: XERO_ORG_A, name: 'Demo Company (Global)', companyCount: 3 }],
    })
  })

  it('asks to confirm a change when only a cursor names the previous Organisation (core rule 11)', async () => {
    grants = createFakeGrantService({ connected: true })
    connectionsHandler = () => ({ status: 200, body: [connection(CONN_B, XERO_ORG_B, 'Second Ltd')] })
    cursorRows = [{ cursor: JSON.stringify({ v: 1, xeroOrganisationId: XERO_ORG_A, modifiedSince: '2026-10-01T00:00:00.000Z' }) }, { cursor: 'not json' }, { cursor: null }]
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_B }, grants.state.revisedAt.toISOString()))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({
      code: 'xero.organisation_change_confirmation_required',
      previous: [{ xeroOrganisationId: XERO_ORG_A, name: null, companyCount: 0 }],
    })
  })

  it('blocks a switch while invoices are mapped under a previous Organisation', async () => {
    connectionsHandler = () => ({ status: 200, body: [connection(CONN_A, XERO_ORG_A, 'Demo Company (Global)'), connection(CONN_B, XERO_ORG_B, 'Second Ltd')] })
    mappingRows = [
      { prefix: XERO_ORG_A, entity_type: 'customers.company', total: 3 },
      { prefix: XERO_ORG_A, entity_type: 'sales.invoice', total: 2 },
    ]
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_B, confirmChange: true }, grants.state.revisedAt.toISOString()))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({
      code: 'xero.organisation_switch_blocked',
      previous: [{ xeroOrganisationId: XERO_ORG_A, name: 'Demo Company (Global)', invoiceCount: 2 }],
    })
  })

  it('refuses an Organisation outside the grant with 422', async () => {
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_C }, grants.state.revisedAt.toISOString()))
    expect(response.status).toBe(422)
    expect(await json(response)).toMatchObject({ code: 'xero.organisation_not_authorised' })
  })

  it('answers not_connected without a grant', async () => {
    grants.setStatus('none')
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_A }))
    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ code: 'not_connected' })
  })

  it('answers 503 xero.unavailable when the re-read fails', async () => {
    connectionsHandler = () => ({ status: 502 })
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_A }))
    expect(response.status).toBe(503)
  })

  it('returns the guard response when a mutation guard blocks the save', async () => {
    registerMutationGuards([
      {
        moduleId: 'test',
        guards: [
          {
            id: 'test.xero-lock',
            targetEntity: 'integrations.oauth_grant',
            operations: ['update'],
            validate: async () => ({ ok: false, status: 423, body: { error: 'Locked', code: 'record_locked' } }),
          },
        ],
      },
    ])
    const response = await putOrganisation(putRequest({ xeroOrganisationId: XERO_ORG_A }, grants.state.revisedAt.toISOString()))
    expect(response.status).toBe(423)
    expect(grants.calls.some((call) => call.method === 'updateProviderData')).toBe(false)
  })

  it('rejects a body that is not a Xero Organisation id', async () => {
    const response = await putOrganisation(putRequest({ xeroOrganisationId: 'not-a-uuid' }))
    expect(response.status).toBe(400)
  })
})
