/** @jest-environment node */
import type { MutationGuard } from '@open-mercato/shared/lib/crud/mutation-guard-registry'
import { registerMutationGuards } from '@open-mercato/shared/lib/crud/mutation-guard-store'
import type { KmsService } from '@open-mercato/shared/lib/encryption/kms'
import { OAuthGrantError } from '../../../../lib/oauth/descriptor'

const mockGetAuthFromRequest = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockResolveOrganizationScope = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockGetGrantedFeatures = jest.fn()
const mockEraseIntegrationCredentials = jest.fn()
const mockCreateCredentialsService = jest.fn()
const mockGetRowUpdatedAt = jest.fn()
const mockSaveCredentials = jest.fn()
const mockFakeServerModuleLoads = jest.fn()
const mockStartFakeAuthorizationServer = jest.fn()
const mockExchangeAuthorizationCode = jest.fn()
const mockSaveClientConfiguration = jest.fn()
const mockCompleteConnect = jest.fn()
const mockGetAccessToken = jest.fn()
const mockEm = { name: 'request-em' }

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScope(...args),
}))

jest.mock('@open-mercato/core/modules/integrations/lib/credentials-service', () => ({
  eraseIntegrationCredentials: (...args: unknown[]) => mockEraseIntegrationCredentials(...args),
  createCredentialsService: (...args: unknown[]) => mockCreateCredentialsService(...args),
}))

jest.mock('@open-mercato/core/modules/integrations/lib/oauth/authorization', () => ({
  exchangeAuthorizationCode: (...args: unknown[]) => mockExchangeAuthorizationCode(...args),
}))

jest.mock('@open-mercato/core/modules/integrations/lib/oauth/testing/fakeAuthorizationServer', () => {
  mockFakeServerModuleLoads()
  return { startFakeAuthorizationServer: (...args: unknown[]) => mockStartFakeAuthorizationServer(...args) }
})

import { POST, metadata, openApi } from '../route'

const ROUTE_URL = 'http://localhost/api/integrations/test-oauth-grants'
const USER_ID = 'user-1'
const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_TENANT_ID = '99999999-9999-4999-8999-999999999999'
const ORG_ID = '22222222-2222-4222-8222-222222222222'
const HOME_ORG_ID = '33333333-3333-4333-8333-333333333333'
const GRANT_ROW_ID = 'test_oauth_grant__oauth_grant'
const FAKE_SERVER_GLOBAL_KEY = '__omTestOAuthGrantsFakeServer__'
const ALL_ACTIONS = ['connect', 'refresh', 'corruptGrant', 'reset'] as const
const TOKEN_PATTERN = /fake_(?:at|rt)_|access_?token|refresh_?token/i
const FAKE_ORIGIN = 'http://127.0.0.1:45555'
const FAKE_CLIENT = { clientId: 'fake-client-id', clientSecret: 'fake-client-secret' }
const TEST_GRANT_DEFAULT_SCOPES = ['test.read', 'test.write']
const REVISED_AT = new Date('2026-10-12T08:00:00.000Z')
const TOKEN_RESPONSE = {
  accessToken: 'fake_at_0123',
  tokenType: 'Bearer',
  expiresInSec: 3600,
  refreshToken: 'fake_rt_4567',
  scope: null,
}

type FakeServerSlot = typeof globalThis & { [FAKE_SERVER_GLOBAL_KEY]?: Promise<{ reset: () => void }> }

const registrations: Record<string, unknown> = {
  em: mockEm,
  integrationCredentialsService: {
    save: (...args: unknown[]) => mockSaveClientConfiguration(...args),
  },
  integrationOAuthGrantService: {
    completeConnect: (...args: unknown[]) => mockCompleteConnect(...args),
    getAccessToken: (...args: unknown[]) => mockGetAccessToken(...args),
  },
  rbacService: {
    userHasAllFeatures: (...args: unknown[]) => mockUserHasAllFeatures(...args),
    getGrantedFeatures: (...args: unknown[]) => mockGetGrantedFeatures(...args),
  },
}

const mockContainer = {
  hasRegistration: (name: string) => name in registrations,
  resolve: (name: string) => {
    if (!(name in registrations)) throw new Error(`[internal] unexpected resolve: ${name}`)
    return registrations[name]
  },
}

function postAction(body: unknown): Promise<Response> {
  return POST(new Request(ROUTE_URL, { method: 'POST', body: JSON.stringify(body) }))
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  const raw = await response.text()
  expect(raw).not.toMatch(TOKEN_PATTERN)
  return JSON.parse(raw) as Record<string, unknown>
}

function expectNoWrites(): void {
  expect(mockEraseIntegrationCredentials).not.toHaveBeenCalled()
  expect(mockSaveCredentials).not.toHaveBeenCalled()
  expect(mockSaveClientConfiguration).not.toHaveBeenCalled()
  expect(mockCompleteConnect).not.toHaveBeenCalled()
  expect(mockGetAccessToken).not.toHaveBeenCalled()
}

function createFakeServer() {
  return {
    authorizationEndpoint: `${FAKE_ORIGIN}/authorize`,
    tokenEndpoint: `${FAKE_ORIGIN}/token`,
    revocationEndpoint: `${FAKE_ORIGIN}/revoke`,
    ...FAKE_CLIENT,
    issueAuthorizationCode: jest.fn(() => 'authorization-code-1'),
    inject: jest.fn(),
    takePendingInjections: jest.fn(() => []),
    reset: jest.fn(),
  }
}

const TEST_GRANT_DESCRIPTOR = {
  integrationId: 'test_oauth_grant',
  authorizationEndpoint: `${FAKE_ORIGIN}/authorize`,
  tokenEndpoint: `${FAKE_ORIGIN}/token`,
  revocationEndpoint: `${FAKE_ORIGIN}/revoke`,
  defaultScopes: TEST_GRANT_DEFAULT_SCOPES,
}

function registerGuard(guard: Partial<MutationGuard> & Pick<MutationGuard, 'validate'>): void {
  registerMutationGuards([
    {
      moduleId: 'test',
      guards: [{ id: 'test.oauth-grant-guard', targetEntity: 'integrations.oauth_grant', operations: ['update'], ...guard }],
    },
  ])
}

describe('POST /api/integrations/test-oauth-grants', () => {
  const originalFlag = process.env.OM_ENABLE_TEST_OAUTH_GRANTS

  beforeEach(() => {
    jest.clearAllMocks()
    process.env.OM_ENABLE_TEST_OAUTH_GRANTS = 'true'
    registerMutationGuards([])
    delete (globalThis as FakeServerSlot)[FAKE_SERVER_GLOBAL_KEY]
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID, orgId: ORG_ID })
    mockCreateRequestContainer.mockResolvedValue(mockContainer)
    mockResolveOrganizationScope.mockResolvedValue({ selectedId: ORG_ID, filterIds: [ORG_ID], allowedIds: null, tenantId: TENANT_ID })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockGetGrantedFeatures.mockResolvedValue(['integrations.*'])
    mockEraseIntegrationCredentials.mockResolvedValue(true)
    mockGetRowUpdatedAt.mockResolvedValue(null)
    mockSaveCredentials.mockResolvedValue(undefined)
    mockCreateCredentialsService.mockReturnValue({ getRowUpdatedAt: mockGetRowUpdatedAt, save: mockSaveCredentials })
    mockStartFakeAuthorizationServer.mockImplementation(async () => createFakeServer())
    mockExchangeAuthorizationCode.mockResolvedValue(TOKEN_RESPONSE)
    mockSaveClientConfiguration.mockResolvedValue(undefined)
    mockCompleteConnect.mockResolvedValue({
      reconnect: false,
      replacedUnreadable: false,
      previousProviderData: null,
      revisedAt: REVISED_AT,
    })
    mockGetAccessToken.mockResolvedValue({
      accessToken: 'fake_at_refreshed',
      expiresAt: new Date('2026-10-12T09:00:00.000Z'),
      degraded: false,
      grantedScopes: TEST_GRANT_DEFAULT_SCOPES,
      providerData: null,
    })
  })

  afterAll(() => {
    registerMutationGuards([])
    delete (globalThis as FakeServerSlot)[FAKE_SERVER_GLOBAL_KEY]
    if (originalFlag === undefined) delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
    else process.env.OM_ENABLE_TEST_OAUTH_GRANTS = originalFlag
  })

  it('declares an explicit path, the credentials-manage guard and OpenAPI docs', () => {
    expect(metadata).toEqual({
      path: '/integrations/test-oauth-grants',
      POST: { requireAuth: true, requireFeatures: ['integrations.credentials.manage'] },
    })
    expect(openApi.methods.POST?.requestBody?.schema).toBeDefined()
    expect(openApi.methods.POST?.errors?.map((entry) => entry.status)).toEqual([400, 401, 403, 404, 409])
  })

  it.each([undefined, 'false', '0'])('answers 404 for every action with the flag %p, with no side effect', async (flag) => {
    if (flag === undefined) delete process.env.OM_ENABLE_TEST_OAUTH_GRANTS
    else process.env.OM_ENABLE_TEST_OAUTH_GRANTS = flag

    for (const action of ALL_ACTIONS) {
      const response = await postAction({ action, integrationId: 'test_oauth_grant' })
      expect(response.status).toBe(404)
    }

    expect(mockGetAuthFromRequest).not.toHaveBeenCalled()
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    expect(mockFakeServerModuleLoads).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it.each(ALL_ACTIONS)('answers 404 for %s on any integration other than test_oauth_grant', async (action) => {
    const response = await postAction({ action, integrationId: 'gateway_stripe' })

    expect(response.status).toBe(404)
    expect(mockCreateRequestContainer).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it.each([
    [{ action: 'delete', integrationId: 'test_oauth_grant' }],
    [{ action: '__probe__' }],
    [{ action: 'reset' }],
    [{ action: 'refresh', integrationId: 'test_oauth_grant', outcome: 'server_error' }],
    [{ action: 'connect', integrationId: 'test_oauth_grant', scopes: [''] }],
  ])('rejects the invalid body %j with 400', async (body) => {
    const response = await postAction(body)

    expect(response.status).toBe(400)
    expect(await readBody(response)).toMatchObject({ error: 'Invalid request body' })
    expectNoWrites()
  })

  it('answers 400 organization_scope_required, never 401, when the auth context has no tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: null, orgId: null })

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(400)
    expect(await readBody(response)).toMatchObject({ code: 'organization_scope_required' })
    expectNoWrites()
  })

  it.each([
    ['with a selected organization', ORG_ID],
    ['on all organizations', null],
  ])('answers 403 to a super admin acting in another tenant %s', async (_label, orgId) => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: USER_ID,
      tenantId: OTHER_TENANT_ID,
      orgId,
      actorTenantId: TENANT_ID,
      actorOrgId: HOME_ORG_ID,
      isSuperAdmin: true,
    })

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(403)
    expect(mockUserHasAllFeatures).not.toHaveBeenCalled()
    expectNoWrites()
  })

  it('writes under the super admin own organization on all organizations in their own tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: USER_ID,
      tenantId: TENANT_ID,
      orgId: null,
      actorTenantId: TENANT_ID,
      actorOrgId: HOME_ORG_ID,
      isSuperAdmin: true,
    })
    mockResolveOrganizationScope.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID })

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(200)
    const scope = { tenantId: TENANT_ID, organizationId: HOME_ORG_ID }
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(USER_ID, ['integrations.credentials.manage'], scope)
    expect(mockEraseIntegrationCredentials).toHaveBeenCalledWith(mockEm, GRANT_ROW_ID, scope)
    expect(mockEraseIntegrationCredentials).toHaveBeenCalledWith(mockEm, 'test_oauth_grant', scope)
  })

  it.each([
    ['filterIds', { selectedId: null, filterIds: [], allowedIds: null, tenantId: TENANT_ID }],
    ['allowedIds', { selectedId: ORG_ID, filterIds: null, allowedIds: [], tenantId: TENANT_ID }],
  ])('answers 403 to an explicitly empty organization scope (%s)', async (_label, scope) => {
    mockResolveOrganizationScope.mockResolvedValue(scope)

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(403)
    expect(mockResolveOrganizationScope).toHaveBeenCalledWith(
      expect.objectContaining({ container: mockContainer, request: expect.any(Request) }),
    )
    expectNoWrites()
  })

  it('answers 400 organization_scope_required when the organization cannot be resolved', async () => {
    mockGetAuthFromRequest.mockResolvedValue({
      sub: USER_ID,
      tenantId: TENANT_ID,
      orgId: null,
      actorTenantId: TENANT_ID,
      actorOrgId: null,
      isSuperAdmin: true,
    })
    mockResolveOrganizationScope.mockResolvedValue({ selectedId: null, filterIds: null, allowedIds: null, tenantId: TENANT_ID })

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(400)
    expect(await readBody(response)).toMatchObject({ code: 'organization_scope_required' })
    expectNoWrites()
  })

  it('answers 403 when the caller lacks integrations.credentials.manage in the resolved organization', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(403)
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(USER_ID, ['integrations.credentials.manage'], {
      tenantId: TENANT_ID,
      organizationId: ORG_ID,
    })
    expectNoWrites()
  })

  it('runs the registry mutation guards, which can block before any write', async () => {
    const validate = jest.fn(async () => ({ ok: false, status: 423, body: { error: 'Locked by guard' } }))
    registerGuard({ validate })

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(423)
    expect(await readBody(response)).toEqual({ error: 'Locked by guard' })
    expect(validate).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
        userId: USER_ID,
        resourceKind: 'integrations.oauth_grant',
        resourceId: GRANT_ROW_ID,
        operation: 'update',
        requestMethod: 'POST',
      }),
    )
    expectNoWrites()
  })

  it('runs the guards afterSuccess callback once the write is done', async () => {
    const afterSuccess = jest.fn(async () => {
      expect(mockEraseIntegrationCredentials).toHaveBeenCalledTimes(2)
    })
    registerGuard({ validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true })), afterSuccess })

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(200)
    expect(afterSuccess).toHaveBeenCalledTimes(1)
  })

  it('re-validates a guard-modified payload, so a guard cannot redirect the write to another integration', async () => {
    registerGuard({ validate: jest.fn(async () => ({ ok: true, modifiedPayload: { integrationId: 'gateway_stripe' } })) })

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(404)
    expectNoWrites()
  })

  it('refresh forces one refresh of the test grant through the fake server and answers ok', async () => {
    const server = createFakeServer()
    mockStartFakeAuthorizationServer.mockResolvedValue(server)
    const afterSuccess = jest.fn(async () => {
      expect(mockGetAccessToken).toHaveBeenCalled()
    })
    registerGuard({ validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true })), afterSuccess })

    const response = await postAction({ action: 'refresh', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ result: 'ok', degraded: false })
    expect(server.inject).not.toHaveBeenCalled()
    expect(mockGetAccessToken).toHaveBeenCalledWith(
      TEST_GRANT_DESCRIPTOR,
      { integrationId: 'test_oauth_grant', tenantId: TENANT_ID, organizationId: ORG_ID },
      { forceRefresh: true },
    )
    expect(afterSuccess).toHaveBeenCalledTimes(1)
    expect(mockSaveClientConfiguration).not.toHaveBeenCalled()
    expect(mockCompleteConnect).not.toHaveBeenCalled()
  })

  it.each([
    ['invalid_grant', { endpoint: 'token', grantType: 'refresh_token', status: 400, body: { error: 'invalid_grant' } }],
    ['invalid_client', { endpoint: 'token', grantType: 'refresh_token', status: 401, body: { error: 'invalid_client' } }],
    [
      'temporarily_unavailable',
      { endpoint: 'token', grantType: 'refresh_token', status: 400, body: { error: 'temporarily_unavailable' } },
    ],
  ])('refresh configures the %s outcome on the fake token endpoint before refreshing', async (outcome, injection) => {
    const server = createFakeServer()
    server.inject.mockImplementation(() => {
      expect(mockGetAccessToken).not.toHaveBeenCalled()
    })
    mockStartFakeAuthorizationServer.mockResolvedValue(server)

    const response = await postAction({ action: 'refresh', integrationId: 'test_oauth_grant', outcome })

    expect(response.status).toBe(200)
    expect(server.inject).toHaveBeenCalledTimes(1)
    expect(server.inject).toHaveBeenCalledWith(injection)
    expect(mockGetAccessToken).toHaveBeenCalledTimes(1)
    expect(server.takePendingInjections).toHaveBeenCalledTimes(1)
    expect(server.takePendingInjections.mock.invocationCallOrder[0]).toBeGreaterThan(mockGetAccessToken.mock.invocationCallOrder[0])
  })

  it('refresh drops an injected outcome the refresh did not consume, also when it fails', async () => {
    const server = createFakeServer()
    mockStartFakeAuthorizationServer.mockResolvedValue(server)
    mockGetAccessToken.mockRejectedValue(new OAuthGrantError('grant_invalidated'))

    const response = await postAction({ action: 'refresh', integrationId: 'test_oauth_grant', outcome: 'invalid_client' })

    expect(await readBody(response)).toEqual({ result: 'grant_invalidated', degraded: false })
    expect(server.takePendingInjections).toHaveBeenCalledTimes(1)
  })

  it.each(['transient', 'grant_invalidated', 'client_misconfigured', 'not_connected', 'platform_unavailable'] as const)(
    'refresh answers 200 with the %s Token Failure',
    async (code) => {
      mockGetAccessToken.mockRejectedValue(new OAuthGrantError(code))

      const response = await postAction({ action: 'refresh', integrationId: 'test_oauth_grant', outcome: 'invalid_grant' })

      expect(response.status).toBe(200)
      expect(await readBody(response)).toEqual({ result: code, degraded: false })
    },
  )

  it('refresh reports a degraded token as ok with degraded true', async () => {
    mockGetAccessToken.mockResolvedValue({
      accessToken: 'fake_at_stored',
      expiresAt: new Date('2026-10-12T09:00:00.000Z'),
      degraded: true,
      grantedScopes: TEST_GRANT_DEFAULT_SCOPES,
      providerData: null,
    })

    const response = await postAction({ action: 'refresh', integrationId: 'test_oauth_grant', outcome: 'temporarily_unavailable' })

    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ result: 'ok', degraded: true })
  })

  it('refresh rethrows an error that is not a Token Failure and runs no afterSuccess', async () => {
    const afterSuccess = jest.fn(async () => undefined)
    registerGuard({ validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true })), afterSuccess })
    mockGetAccessToken.mockRejectedValue(new OAuthGrantError('connect_persist_failed'))

    await expect(postAction({ action: 'refresh', integrationId: 'test_oauth_grant' })).rejects.toBeInstanceOf(OAuthGrantError)

    expect(afterSuccess).not.toHaveBeenCalled()
  })

  it('connect starts the fake server once, saves the Client Configuration and completes the Connect', async () => {
    const afterSuccess = jest.fn(async () => {
      expect(mockCompleteConnect).toHaveBeenCalled()
    })
    registerGuard({ validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true })), afterSuccess })

    const first = await postAction({ action: 'connect', integrationId: 'test_oauth_grant' })
    const second = await postAction({ action: 'connect', integrationId: 'test_oauth_grant' })

    expect(first.status).toBe(200)
    expect(await readBody(first)).toEqual({ reconnect: false, revisedAt: REVISED_AT.toISOString() })
    expect(second.status).toBe(200)
    expect(mockStartFakeAuthorizationServer).toHaveBeenCalledTimes(1)
    expect(mockStartFakeAuthorizationServer).toHaveBeenCalledWith({ rotation: 'strict' })
    await expect((globalThis as FakeServerSlot)[FAKE_SERVER_GLOBAL_KEY]).resolves.toMatchObject(FAKE_CLIENT)
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
    expect(mockSaveClientConfiguration).toHaveBeenCalledWith('test_oauth_grant', FAKE_CLIENT, scope)
    const descriptor = TEST_GRANT_DESCRIPTOR
    const [exchangeDescriptor, exchangeClient, exchangeInput] = mockExchangeAuthorizationCode.mock.calls[0] as [
      unknown,
      unknown,
      { code: string; redirectUri: string; codeVerifier: string },
    ]
    expect(exchangeDescriptor).toEqual(descriptor)
    expect(exchangeClient).toEqual(FAKE_CLIENT)
    expect(exchangeInput).toEqual({
      code: 'authorization-code-1',
      redirectUri: `${FAKE_ORIGIN}/callback`,
      codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
    expect(mockCompleteConnect).toHaveBeenCalledWith(
      descriptor,
      { integrationId: 'test_oauth_grant', ...scope },
      TOKEN_RESPONSE,
      { clientId: FAKE_CLIENT.clientId, requestedScopes: undefined, actorUserId: USER_ID },
    )
    expect(afterSuccess).toHaveBeenCalledTimes(2)
  })

  it('connect requests the given scopes and never takes endpoints from the request', async () => {
    const server = createFakeServer()
    mockStartFakeAuthorizationServer.mockResolvedValue(server)

    const response = await postAction({
      action: 'connect',
      integrationId: 'test_oauth_grant',
      scopes: ['custom.scope'],
      tokenEndpoint: 'https://attacker.example/token',
    })

    expect(response.status).toBe(200)
    expect(server.issueAuthorizationCode).toHaveBeenCalledWith({
      redirectUri: `${FAKE_ORIGIN}/callback`,
      scope: ['custom.scope'],
      codeChallenge: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    })
    expect(mockExchangeAuthorizationCode.mock.calls[0]?.[0]).toMatchObject({ tokenEndpoint: `${FAKE_ORIGIN}/token` })
    expect(mockCompleteConnect.mock.calls[0]?.[3]).toEqual({
      clientId: FAKE_CLIENT.clientId,
      requestedScopes: ['custom.scope'],
      actorUserId: USER_ID,
    })
  })

  it('connect answers 409 with the Connect Failure code and runs no afterSuccess', async () => {
    const afterSuccess = jest.fn(async () => undefined)
    registerGuard({ validate: jest.fn(async () => ({ ok: true, shouldRunAfterSuccess: true })), afterSuccess })
    mockCompleteConnect.mockRejectedValue(new OAuthGrantError('connect_grant_unreadable'))

    const response = await postAction({ action: 'connect', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(409)
    expect(await readBody(response)).toEqual({ error: 'OAuth connect failed', code: 'connect_grant_unreadable' })
    expect(afterSuccess).not.toHaveBeenCalled()
  })

  it('connect restarts the fake server when an earlier start failed', async () => {
    const failedStart = Promise.reject(new Error('[internal] start failed'))
    failedStart.catch(() => undefined)
    ;(globalThis as FakeServerSlot)[FAKE_SERVER_GLOBAL_KEY] = failedStart

    const response = await postAction({ action: 'connect', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(200)
    expect(mockStartFakeAuthorizationServer).toHaveBeenCalledTimes(1)
    await expect((globalThis as FakeServerSlot)[FAKE_SERVER_GLOBAL_KEY]).resolves.toMatchObject(FAKE_CLIENT)
  })

  it('reset erases the grant row and the Client Configuration row and clears the fake server outcomes', async () => {
    const reset = jest.fn()
    ;(globalThis as FakeServerSlot)[FAKE_SERVER_GLOBAL_KEY] = Promise.resolve({ reset })

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ ok: true })
    const scope = { tenantId: TENANT_ID, organizationId: ORG_ID }
    expect(mockEraseIntegrationCredentials.mock.calls).toEqual([
      [mockEm, GRANT_ROW_ID, scope],
      [mockEm, 'test_oauth_grant', scope],
    ])
    expect(reset).toHaveBeenCalledTimes(1)
    expect(mockSaveCredentials).not.toHaveBeenCalled()
  })

  it('reset drops a fake server slot whose start failed', async () => {
    const failedStart = Promise.reject(new Error('[internal] start failed'))
    failedStart.catch(() => undefined)
    ;(globalThis as FakeServerSlot)[FAKE_SERVER_GLOBAL_KEY] = failedStart

    const response = await postAction({ action: 'reset', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(200)
    expect((globalThis as FakeServerSlot)[FAKE_SERVER_GLOBAL_KEY]).toBeUndefined()
  })

  it('corruptGrant reports false and writes nothing when no live grant exists', async () => {
    const response = await postAction({ action: 'corruptGrant', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ corrupted: false })
    expect(mockGetRowUpdatedAt).toHaveBeenCalledWith(GRANT_ROW_ID, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expectNoWrites()
  })

  it('corruptGrant rewrites a live grant under a random DEK the tenant does not hold', async () => {
    mockGetRowUpdatedAt.mockResolvedValue(new Date('2026-10-01T00:00:00.000Z'))

    const response = await postAction({ action: 'corruptGrant', integrationId: 'test_oauth_grant' })

    expect(response.status).toBe(200)
    expect(await readBody(response)).toEqual({ corrupted: true })
    const [em, encryptionService, options] = mockCreateCredentialsService.mock.calls[0] as [unknown, unknown, { kms: KmsService }]
    expect(em).toBe(mockEm)
    expect(encryptionService).toBeNull()
    expect(options.kms.isHealthy()).toBe(true)
    const dek = await options.kms.getTenantDek(TENANT_ID)
    expect(dek?.tenantId).toBe(TENANT_ID)
    expect(Buffer.from(dek?.key ?? '', 'base64')).toHaveLength(32)
    expect((await options.kms.createTenantDek(TENANT_ID))?.key).toBe(dek?.key)
    expect(mockSaveCredentials).toHaveBeenCalledWith(GRANT_ROW_ID, { corrupted: true }, { tenantId: TENANT_ID, organizationId: ORG_ID })
    expect(mockEraseIntegrationCredentials).not.toHaveBeenCalled()
  })

  it('uses a fresh random DEK for every corruption', async () => {
    mockGetRowUpdatedAt.mockResolvedValue(new Date('2026-10-01T00:00:00.000Z'))

    await postAction({ action: 'corruptGrant', integrationId: 'test_oauth_grant' })
    await postAction({ action: 'corruptGrant', integrationId: 'test_oauth_grant' })

    const keys = await Promise.all(
      mockCreateCredentialsService.mock.calls.map(async ([, , options]) => (await (options as { kms: KmsService }).kms.getTenantDek(TENANT_ID))?.key),
    )
    expect(new Set(keys).size).toBe(2)
  })
})
