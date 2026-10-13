/** @jest-environment node */
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import {
  startFakeAuthorizationServer,
  type FakeAuthorizationServer,
} from '@open-mercato/core/modules/integrations/lib/oauth/testing/fakeAuthorizationServer'
import { createFakeGrantService, type FakeGrantService } from './support/fakeGrantService'
import { createFakeContainer, createMemoryCache, type MemoryCache } from './support/fakeContainer'
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

jest.mock('../lib/endpoints', () => ({
  resolveXeroEndpoints: (...args: unknown[]) => mockResolveEndpoints(...args),
}))

import { POST as initiate, metadata as initiateMetadata } from '../api/post/oauth/initiate/route'
import { GET as callback, metadata as callbackMetadata } from '../api/get/oauth/callback/route'

const APP_ORIGIN = 'http://localhost:3000'
const REDIRECT_URI = `${APP_ORIGIN}/api/sync_xero/oauth/callback`
const USER_ID = 'user-1'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ORG_ID = '33333333-3333-4333-8333-333333333333'
const XERO_ORG_A = '996096ec-5362-40dd-be90-3e6a2be09dce'
const XERO_ORG_B = '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6'
const CONN_A = 'a0a0a0a0-0000-4000-8000-00000000000a'
const CONN_B = 'b0b0b0b0-0000-4000-8000-00000000000b'
const XERO_SCOPES = ['offline_access', 'accounting.contacts.read', 'accounting.invoices.read']

const organisationA = { id: CONN_A, tenantId: XERO_ORG_A, tenantType: 'ORGANISATION', tenantName: 'Demo Company (Global)', authEventId: 'evt-1' }
const organisationB = { id: CONN_B, tenantId: XERO_ORG_B, tenantType: 'ORGANISATION', tenantName: 'Second Ltd', authEventId: 'evt-0' }

let authorizationServer: FakeAuthorizationServer
let xeroApi: StubHttpServer
let connectionsHandler: (query: URLSearchParams) => StubResponse
let grants: FakeGrantService
let cache: MemoryCache
let clientConfiguration: Record<string, unknown> | null
let mappingCount: number
let allowedOrganizations: Set<string>
const rbacCalls: Array<{ userId: string; features: string[]; scope: unknown }> = []
const savedEnv = { ...process.env }

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'RS256' })}.${encode(payload)}.signature`
}

function buildContainer() {
  return createFakeContainer({
    rbacService: {
      async userHasAllFeatures(userId: string, features: string[], scope: { organizationId: string | null }) {
        rbacCalls.push({ userId, features, scope })
        return scope.organizationId !== null && allowedOrganizations.has(scope.organizationId)
      },
      async getGrantedFeatures() {
        return ['integrations.*']
      },
    },
    integrationCredentialsService: { resolve: async () => clientConfiguration },
    integrationOAuthGrantService: grants.service,
    cache,
    em: { count: async () => mappingCount },
  })
}

function registerGuard(validate: MutationGuard['validate']): void {
  registerMutationGuards([
    {
      moduleId: 'test',
      guards: [{ id: 'test.xero-grant-guard', targetEntity: 'integrations.oauth_grant', operations: ['update'], validate }],
    },
  ])
}

function initiateRequest(body: unknown = {}): Request {
  return new Request(`${APP_ORIGIN}/api/sync_xero/oauth/initiate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function readStateCookie(response: Response): string {
  const header = response.headers.get('set-cookie') ?? ''
  const match = /om_xero_oauth_state=([^;]*)/.exec(header)
  if (!match) throw new Error('[internal] no state cookie')
  return match[1]
}

type StartedConnect = { state: string; cookie: string; codeChallenge: string }

async function startConnect(body: unknown = {}): Promise<StartedConnect> {
  const response = await initiate(initiateRequest(body))
  expect(response.status).toBe(200)
  const { authorizeUrl } = (await response.json()) as { authorizeUrl: string }
  const url = new URL(authorizeUrl)
  return {
    state: url.searchParams.get('state') as string,
    cookie: readStateCookie(response),
    codeChallenge: url.searchParams.get('code_challenge') as string,
  }
}

function callbackRequest(query: Record<string, string>, cookie: string | null): Request {
  const url = new URL(REDIRECT_URI)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return new Request(url.toString(), { headers: cookie === null ? {} : { cookie: `om_xero_oauth_state=${cookie}` } })
}

async function finishConnect(started: StartedConnect, extraQuery: Record<string, string> = {}): Promise<Response> {
  const code = authorizationServer.issueAuthorizationCode({ redirectUri: REDIRECT_URI, scope: XERO_SCOPES, codeChallenge: started.codeChallenge })
  return callback(callbackRequest({ code, state: started.state, ...extraQuery }, started.cookie))
}

function resultOf(response: Response): string | null {
  expect(response.status).toBe(302)
  const location = new URL(response.headers.get('location') as string)
  expect(`${location.origin}${location.pathname}`).toBe(`${APP_ORIGIN}/backend/integrations/sync_xero`)
  expect(location.searchParams.get('tab')).toBe('xero')
  return location.searchParams.get('xeroResult')
}

function expectCookieCleared(response: Response): void {
  expect(response.headers.get('set-cookie')).toMatch(/om_xero_oauth_state=;.*Max-Age=0/i)
}

function updateProviderDataCalls() {
  return grants.calls.filter((call) => call.method === 'updateProviderData')
}

beforeAll(async () => {
  authorizationServer = await startFakeAuthorizationServer({ rotation: 'strict', strictGraceMs: 30 * 60 * 1000, accessTokenTtlSec: 1800 })
  xeroApi = await startStubHttpServer((request) =>
    request.path === '/connections' ? connectionsHandler(request.query) : { status: 404 },
  )
})

afterAll(async () => {
  await authorizationServer.close()
  await xeroApi.close()
  registerMutationGuards([])
  process.env = savedEnv
})

beforeEach(() => {
  process.env = { ...savedEnv, NODE_ENV: 'test', OM_HUB_OAUTH_STATE_KEY: 'sync-xero-test-state-key-0123456789abcdef' }
  delete process.env.APP_URL
  delete process.env.NEXT_PUBLIC_APP_URL
  authorizationServer.reset()
  registerMutationGuards([])
  rbacCalls.length = 0
  grants = createFakeGrantService()
  cache = createMemoryCache()
  clientConfiguration = { clientId: authorizationServer.clientId, clientSecret: authorizationServer.clientSecret }
  mappingCount = 0
  allowedOrganizations = new Set([ORG_ID])
  connectionsHandler = () => ({ status: 200, body: [organisationA] })
  mockGetAuthFromRequest.mockReset().mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
  mockCreateRequestContainer.mockReset().mockImplementation(async () => buildContainer())
  mockResolveOrganizationScope.mockReset().mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: null, tenantId: TENANT_ID })
  mockResolveEndpoints.mockReset().mockResolvedValue({
    authorize: authorizationServer.authorizationEndpoint,
    token: authorizationServer.tokenEndpoint,
    revoke: authorizationServer.revocationEndpoint ?? undefined,
    connections: `${xeroApi.url}/connections`,
    accounting: `${xeroApi.url}/api.xro/2.0`,
  })
})

describe('POST /api/sync_xero/oauth/initiate', () => {
  it('requires integrations.credentials.manage', () => {
    expect(initiateMetadata).toEqual({
      path: '/sync_xero/oauth/initiate',
      POST: { requireAuth: true, requireFeatures: ['integrations.credentials.manage'] },
    })
  })

  it('answers the Xero authorization URL with PKCE and sets the state cookie', async () => {
    const response = await initiate(initiateRequest())
    expect(response.status).toBe(200)
    const { authorizeUrl } = (await response.json()) as { authorizeUrl: string }
    const url = new URL(authorizeUrl)
    expect(`${url.origin}${url.pathname}`).toBe(authorizationServer.authorizationEndpoint)
    expect(url.searchParams.get('client_id')).toBe(authorizationServer.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI)
    expect(url.searchParams.get('scope')).toBe(XERO_SCOPES.join(' '))
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toMatch(/^om_xero_oauth_state=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=lax/i)
    expect(cookie).toMatch(/Path=\//)
    expect(cookie).toMatch(/Max-Age=300/)
  })

  it('refuses a super admin acting in another tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID, actorTenantId: '99999999-9999-4999-8999-999999999999' })
    const response = await initiate(initiateRequest())
    expect(response.status).toBe(403)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('refuses an explicitly empty organization scope', async () => {
    mockResolveOrganizationScope.mockResolvedValue({ selectedId: null, filterIds: [], allowedIds: [], tenantId: TENANT_ID })
    const response = await initiate(initiateRequest())
    expect(response.status).toBe(403)
  })

  it('answers 400 when no organization resolves', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: null })
    const response = await initiate(initiateRequest())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'organization_scope_required' })
  })

  it('refuses a user without the feature in the active organization', async () => {
    allowedOrganizations = new Set([OTHER_ORG_ID])
    const response = await initiate(initiateRequest())
    expect(response.status).toBe(403)
    expect(rbacCalls[0]).toEqual({ userId: USER_ID, features: ['integrations.credentials.manage'], scope: { tenantId: TENANT_ID, organizationId: ORG_ID } })
  })

  it('answers xero.not_configured without a Client ID and Secret', async () => {
    clientConfiguration = { clientId: 'only-an-id', clientSecret: '  ' }
    const response = await initiate(initiateRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'xero.not_configured' })
  })

  it('rejects an unknown body field', async () => {
    const response = await initiate(initiateRequest({ replaceUnreadable: true, returnUrl: '/elsewhere' }))
    expect(response.status).toBe(400)
  })

  it('answers oauth_base_url_not_configured in production without APP_URL', async () => {
    process.env.NODE_ENV = 'production'
    const response = await initiate(initiateRequest())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'oauth_base_url_not_configured' })
  })

  it('answers 500 missing_secret in production without a state key', async () => {
    process.env.NODE_ENV = 'production'
    process.env.APP_URL = APP_ORIGIN
    delete process.env.OM_HUB_OAUTH_STATE_KEY
    delete process.env.KMS_MASTER_KEY
    const response = await initiate(initiateRequest())
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ code: 'missing_secret' })
  })
})

describe('GET /api/sync_xero/oauth/callback', () => {
  it('requires only a session; the feature is checked in the state organization', () => {
    expect(callbackMetadata).toEqual({ path: '/sync_xero/oauth/callback', GET: { requireAuth: true } })
  })

  it('exchanges the code with the PKCE verifier, stores the grant and selects the only Organisation', async () => {
    const started = await startConnect()
    const response = await finishConnect(started)

    expect(resultOf(response)).toBe('connected')
    expectCookieCleared(response)
    const exchange = authorizationServer.requests().find((request) => request.endpoint === 'token')
    expect(exchange?.params.grant_type).toBe('authorization_code')
    expect(exchange?.params.redirect_uri).toBe(REDIRECT_URI)
    expect(exchange?.params.code_verifier).toHaveLength(43)
    const connect = grants.calls.find((call) => call.method === 'completeConnect')
    expect(connect?.options).toEqual({
      clientId: authorizationServer.clientId,
      requestedScopes: XERO_SCOPES,
      replaceUnreadable: false,
      actorUserId: USER_ID,
    })
    expect(updateProviderDataCalls()).toHaveLength(1)
    expect(updateProviderDataCalls()[0].options).toMatchObject({
      data: { xeroOrganisationId: XERO_ORG_A, xeroConnectionId: CONN_A, xeroOrganisationName: 'Demo Company (Global)' },
      actorUserId: USER_ID,
    })
    expect(grants.state.providerData).toEqual({ xeroOrganisationId: XERO_ORG_A, xeroConnectionId: CONN_A, xeroOrganisationName: 'Demo Company (Global)' })
    expect(response.headers.get('location')).not.toContain(grants.state.accessToken as string)
  })

  it('refuses a replayed state', async () => {
    const started = await startConnect()
    expect(resultOf(await finishConnect(started))).toBe('connected')
    const replay = await finishConnect(started)
    expect(resultOf(replay)).toBe('connect_state_invalid')
    expect(authorizationServer.counters().token.authorizationCode).toBe(1)
  })

  it('refuses an expired state', async () => {
    const started = await startConnect()
    const realNow = Date.now()
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(realNow + 6 * 60 * 1000)
    try {
      expect(resultOf(await finishConnect(started))).toBe('connect_state_invalid')
    } finally {
      nowSpy.mockRestore()
    }
    expect(authorizationServer.counters().token.authorizationCode).toBe(0)
  })

  it('refuses a state from another tenant session', async () => {
    const started = await startConnect()
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: '44444444-4444-4444-8444-444444444444', orgId: ORG_ID })
    expect(resultOf(await finishConnect(started))).toBe('connect_state_invalid')
  })

  it('refuses a state started by another user', async () => {
    const started = await startConnect()
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-2', tenantId: TENANT_ID, orgId: ORG_ID })
    expect(resultOf(await finishConnect(started))).toBe('connect_state_invalid')
  })

  it('checks the feature in the state organization, not the current selection', async () => {
    const started = await startConnect()
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: OTHER_ORG_ID })
    allowedOrganizations = new Set([OTHER_ORG_ID])
    expect(resultOf(await finishConnect(started))).toBe('connect_state_invalid')
    expect(rbacCalls.at(-1)?.scope).toEqual({ tenantId: TENANT_ID, organizationId: ORG_ID })
  })

  it('fails closed when the single-use store cannot record the state', async () => {
    const started = await startConnect()
    cache.failSet = true
    expect(resultOf(await finishConnect(started))).toBe('connect_state_invalid')
    expect(grants.calls.some((call) => call.method === 'completeConnect')).toBe(false)
  })

  it('refuses a callback without the state cookie', async () => {
    const started = await startConnect()
    expect(resultOf(await callback(callbackRequest({ code: 'any', state: started.state }, null)))).toBe('connect_state_invalid')
  })

  it('maps access_denied to connect_cancelled and clears the cookie', async () => {
    const started = await startConnect()
    const response = await callback(callbackRequest({ error: 'access_denied', state: started.state }, started.cookie))
    expect(resultOf(response)).toBe('connect_cancelled')
    expectCookieCleared(response)
  })

  it('reports a guard block without exchanging the code', async () => {
    registerGuard(async () => ({ ok: false, status: 423, body: { error: 'Locked' } }))
    const started = await startConnect()
    expect(resultOf(await finishConnect(started))).toBe('guard_blocked')
    expect(authorizationServer.counters().token.authorizationCode).toBe(0)
  })

  it('reports client_misconfigured when the Client Configuration is gone', async () => {
    const started = await startConnect()
    clientConfiguration = null
    expect(resultOf(await finishConnect(started))).toBe('client_misconfigured')
  })

  it('reports client_misconfigured when Xero rejects the client', async () => {
    const started = await startConnect()
    authorizationServer.inject({ endpoint: 'token', grantType: 'authorization_code', status: 401, body: { error: 'invalid_client' } })
    expect(resultOf(await finishConnect(started))).toBe('client_misconfigured')
  })

  it('reports connect_exchange_failed when the code exchange fails', async () => {
    const started = await startConnect()
    authorizationServer.inject({ endpoint: 'token', grantType: 'authorization_code', status: 400, body: { error: 'invalid_grant' } })
    expect(resultOf(await finishConnect(started))).toBe('connect_exchange_failed')
    expect(grants.calls.some((call) => call.method === 'completeConnect')).toBe(false)
  })

  it('reports a grant-service Connect Failure by its code', async () => {
    const started = await startConnect()
    grants.failNext('completeConnect', 'connect_persist_failed')
    expect(resultOf(await finishConnect(started))).toBe('connect_persist_failed')
  })

  it('takes replaceUnreadable only from the encrypted state', async () => {
    const plain = await startConnect()
    await finishConnect(plain, { replaceUnreadable: 'true' })
    expect(grants.calls.filter((call) => call.method === 'completeConnect').at(-1)?.options).toMatchObject({ replaceUnreadable: false })

    const confirmed = await startConnect({ replaceUnreadable: true })
    await finishConnect(confirmed)
    expect(grants.calls.filter((call) => call.method === 'completeConnect').at(-1)?.options).toMatchObject({ replaceUnreadable: true })
  })
})

describe('GET /api/sync_xero/oauth/callback — automatic Organisation selection', () => {
  it('selects the only Organisation of the consent round filtered by authEventId', async () => {
    grants = createFakeGrantService({ tokenFactory: () => jwt({ authentication_event_id: 'evt-1' }) })
    connectionsHandler = (query) => ({ status: 200, body: query.get('authEventId') === 'evt-1' ? [organisationA] : [organisationA, organisationB] })
    expect(resultOf(await finishConnect(await startConnect()))).toBe('connected')
    expect(xeroApi.requests.at(-1)?.query.get('authEventId')).toBe('evt-1')
  })

  it('leaves the Account pending when the consent covered several Organisations', async () => {
    connectionsHandler = () => ({ status: 200, body: [organisationA, organisationB] })
    expect(resultOf(await finishConnect(await startConnect()))).toBe('account_pending')
    expect(updateProviderDataCalls()).toHaveLength(0)
  })

  it('leaves the Account pending on a first connect over existing Xero mappings', async () => {
    mappingCount = 3
    expect(resultOf(await finishConnect(await startConnect()))).toBe('account_pending')
    expect(updateProviderDataCalls()).toHaveLength(0)
  })

  it('re-selects the previous Organisation on a Reconnect, through the unfiltered list', async () => {
    grants = createFakeGrantService({
      connected: true,
      providerData: { xeroOrganisationId: XERO_ORG_A, xeroConnectionId: CONN_A, xeroOrganisationName: 'Demo Company (Global)' },
      tokenFactory: () => jwt({ authentication_event_id: 'evt-new' }),
    })
    mappingCount = 3
    connectionsHandler = (query) => ({ status: 200, body: query.get('authEventId') ? [] : [organisationA] })
    expect(resultOf(await finishConnect(await startConnect()))).toBe('connected')
    expect(updateProviderDataCalls()).toHaveLength(1)
  })

  it('asks for a choice when the Reconnect returned another Organisation', async () => {
    grants = createFakeGrantService({
      connected: true,
      providerData: { xeroOrganisationId: XERO_ORG_A, xeroConnectionId: CONN_A, xeroOrganisationName: 'Demo Company (Global)' },
    })
    connectionsHandler = () => ({ status: 200, body: [organisationB] })
    expect(resultOf(await finishConnect(await startConnect()))).toBe('account_pending')
  })

  it('leaves the Account pending after one failed /connections call', async () => {
    connectionsHandler = () => ({ status: 503 })
    const before = xeroApi.requests.length
    expect(resultOf(await finishConnect(await startConnect()))).toBe('account_pending')
    expect(xeroApi.requests.length - before).toBe(1)
  })

  it('leaves the Account pending when a guard blocks the selection', async () => {
    registerGuard(async (input) =>
      input.mutationPayload && 'providerData' in input.mutationPayload
        ? { ok: false, status: 423, body: { error: 'Locked' } }
        : { ok: true },
    )
    expect(resultOf(await finishConnect(await startConnect()))).toBe('account_pending')
    expect(updateProviderDataCalls()).toHaveLength(0)
  })

  it('leaves the Account pending when the selection hits a stale revision', async () => {
    grants.failWith('updateProviderData', Object.assign(new Error('[internal] conflict'), { status: 409 }))
    expect(resultOf(await finishConnect(await startConnect()))).toBe('account_pending')
  })
})
