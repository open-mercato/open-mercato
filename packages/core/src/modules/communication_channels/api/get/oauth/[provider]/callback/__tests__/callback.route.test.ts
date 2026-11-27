/** @jest-environment node */

/**
 * Integration tests for GET /api/communication_channels/oauth/[provider]/callback
 *
 * Covers:
 * 1. Happy path — first callback succeeds and redirects with oauth=connected
 * 2. Replay — same state + cookie replayed → redirects with code=replay, no channel row created
 * 3. Cache unavailable — cache DI binding resolves to undefined → redirects with code=state_store_unavailable
 */

import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { encryptOAuthState } from '../../../../../../lib/oauth-state'
import { GET } from '../route'

// ─── Auth mock ───────────────────────────────────────────────────────────────

const mockGetAuthFromRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

// ─── DI container mock ───────────────────────────────────────────────────────

const mockContainerResolve = jest.fn()
const mockCreateRequestContainer = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

// ─── Adapter registry mock ───────────────────────────────────────────────────

const mockExchangeOAuthCode = jest.fn()
const mockGetChannelAdapter = jest.fn()

jest.mock('../../../../../../lib/adapter-registry-singleton', () => ({
  getChannelAdapter: (...args: unknown[]) => mockGetChannelAdapter(...args),
}))

// ─── createConnectedChannelRow mock ──────────────────────────────────────────

const mockCreateConnectedChannelRow = jest.fn()

jest.mock('../../../../../../lib/connect-channel', () => ({
  createConnectedChannelRow: (...args: unknown[]) => mockCreateConnectedChannelRow(...args),
  MailboxAlreadyConnectedError: class MailboxAlreadyConnectedError extends Error {
    existingProviderKey: string
    constructor(existingProviderKey: string) {
      super('already connected')
      this.existingProviderKey = existingProviderKey
    }
  },
}))

// ─── resolveOAuthClientCredentials mock ─────────────────────────────────────

const mockResolveOAuthClientCredentials = jest.fn()

jest.mock('../../../../../../lib/oauth-client-config', () => ({
  resolveOAuthClientCredentials: (...args: unknown[]) => mockResolveOAuthClientCredentials(...args),
}))

// ─── url helper mock ─────────────────────────────────────────────────────────

jest.mock('@open-mercato/shared/lib/url', () => ({
  getAppBaseUrl: (_req: unknown) => 'https://app.example.com',
  toAbsoluteUrl: (_req: unknown, path: string) => `https://app.example.com${path}`,
}))

// ─── Helpers ─────────────────────────────────────────────────────────────────

const SECRET = 'test-callback-route-secret-' + Math.random().toString(36).slice(2)

beforeAll(() => {
  process.env.OM_HUB_OAUTH_STATE_KEY = SECRET
})

afterAll(() => {
  delete process.env.OM_HUB_OAUTH_STATE_KEY
})

const USER_ID = 'user-1'
const TENANT_ID = 'tenant-1'
const ORGANIZATION_ID = 'org-1'
const PROVIDER = 'gmail'

function makeStateCookie(overrides: Partial<Parameters<typeof encryptOAuthState>[0]> = {}) {
  return encryptOAuthState({
    state: 'test-state-nonce',
    nonce: 'test-nonce',
    userId: USER_ID,
    tenantId: TENANT_ID,
    providerKey: PROVIDER,
    returnUrl: '/backend/profile/communication-channels',
    expiresAt: Date.now() + 5 * 60 * 1000,
    ...overrides,
  })
}

function buildRequest(query: string, cookieValue: string) {
  return new Request(
    `https://app.example.com/api/communication_channels/oauth/${PROVIDER}/callback${query}`,
    {
      headers: {
        cookie: `om_cc_oauth_state=${encodeURIComponent(cookieValue)}`,
        host: 'app.example.com',
      },
    },
  )
}

/** Simple in-memory cache store (has/set). */
function createMemoryCache() {
  const map = new Map<string, unknown>()
  return {
    has: async (key: string) => map.has(key),
    set: async (key: string, value: unknown) => { map.set(key, value) },
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /api/communication_channels/oauth/[provider]/callback', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    mockGetAuthFromRequest.mockResolvedValue({ sub: USER_ID, tenantId: TENANT_ID })

    mockGetChannelAdapter.mockReturnValue({
      exchangeOAuthCode: mockExchangeOAuthCode,
    })

    mockExchangeOAuthCode.mockResolvedValue({
      credentials: { access_token: 'tok' },
      externalIdentifier: 'user@example.com',
      displayName: 'User Gmail',
      expiresAt: new Date(Date.now() + 3600 * 1000),
    })

    mockResolveOAuthClientCredentials.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    mockCreateConnectedChannelRow.mockResolvedValue({ id: 'channel-abc-123' })

    // Default container: valid cache + a mock em
    const mockEm = { fork: () => mockEm, findOne: jest.fn() }
    mockCreateRequestContainer.mockResolvedValue({
      resolve: mockContainerResolve,
    })
  })

  // ── Happy path ──────────────────────────────────────────────────────────────

  it.each([
    { externalIdentifier: 'user@example.com', adoptUnidentifiedChannel: true },
    { externalIdentifier: undefined, adoptUnidentifiedChannel: false },
  ])('redirects with oauth=connected and sets legacy adoption to $adoptUnidentifiedChannel', async ({
    externalIdentifier,
    adoptUnidentifiedChannel,
  }) => {
    mockExchangeOAuthCode.mockResolvedValueOnce({
      credentials: { access_token: 'tok' },
      externalIdentifier,
    })
    jest.mocked(findOneWithDecryption).mockResolvedValueOnce({ id: 'saved-credentials' })
    const credentialsService = { save: jest.fn().mockResolvedValue(undefined) }
    const memCache = createMemoryCache()
    mockContainerResolve.mockImplementation((token: string) => {
      if (token === 'cache') return memCache
      if (token === 'em') return { fork: () => ({ findOne: jest.fn() }) }
      if (token === 'integrationCredentialsService') return credentialsService
      return undefined
    })

    const cookie = makeStateCookie({ organizationId: ORGANIZATION_ID })
    const req = buildRequest('?code=auth-code-123&state=test-state-nonce', cookie)
    const res = await GET(req, { params: { provider: PROVIDER } })

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toBeTruthy()
    expect(location).toContain('oauth=connected')
    expect(mockCreateConnectedChannelRow).toHaveBeenCalledTimes(1)
    expect(mockCreateConnectedChannelRow).toHaveBeenCalledWith(expect.objectContaining({
      credentialsRefId: 'saved-credentials',
      externalIdentifier: externalIdentifier ?? null,
      scope: { tenantId: TENANT_ID, organizationId: ORGANIZATION_ID },
      adoptUnidentifiedChannel,
    }))
  })

  it('returns setup guidance instead of exchanging a code when client configuration becomes incomplete', async () => {
    const memCache = createMemoryCache()
    mockContainerResolve.mockImplementation((token: string) => token === 'cache' ? memCache : null)
    mockResolveOAuthClientCredentials.mockResolvedValue(null)

    const req = buildRequest('?code=auth-code-123&state=test-state-nonce', makeStateCookie())
    const response = await GET(req, { params: { provider: PROVIDER } })

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toContain('code=oauth_client_not_configured')
    expect(mockResolveOAuthClientCredentials).toHaveBeenCalledWith(
      null, PROVIDER, expect.objectContaining({ tenantId: TENANT_ID }), { requireComplete: true },
    )
    expect(mockExchangeOAuthCode).not.toHaveBeenCalled()
  })

  // ── Replay ──────────────────────────────────────────────────────────────────

  it('replay: second callback with same state → redirect with code=replay, no channel row created', async () => {
    // Pre-populate the cache so has() returns true immediately
    const stateNonce = 'replay-state-nonce-' + Math.random().toString(36).slice(2)
    const prePopulatedCache = {
      has: jest.fn().mockResolvedValue(true),
      set: jest.fn().mockResolvedValue(undefined),
    }
    mockContainerResolve.mockImplementation((token: string) => {
      if (token === 'cache') return prePopulatedCache
      if (token === 'em') return { fork: () => ({ findOne: jest.fn() }) }
      if (token === 'integrationCredentialsService') return null
      return undefined
    })

    const cookie = makeStateCookie({ state: stateNonce })
    const req = buildRequest(`?code=auth-code-456&state=${stateNonce}`, cookie)
    const res = await GET(req, { params: { provider: PROVIDER } })

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toBeTruthy()
    expect(location).toContain('code=replay')
    expect(mockCreateConnectedChannelRow).not.toHaveBeenCalled()
  })

  // ── Cache unavailable ───────────────────────────────────────────────────────

  it('cache unavailable: container.resolve("cache") returns undefined → redirect with code=state_store_unavailable', async () => {
    mockContainerResolve.mockImplementation((token: string) => {
      if (token === 'cache') return undefined
      if (token === 'em') return { fork: () => ({ findOne: jest.fn() }) }
      if (token === 'integrationCredentialsService') return null
      return undefined
    })

    const cookie = makeStateCookie()
    const req = buildRequest('?code=auth-code-789&state=test-state-nonce', cookie)
    const res = await GET(req, { params: { provider: PROVIDER } })

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toBeTruthy()
    expect(location).toContain('code=state_store_unavailable')
    expect(mockCreateConnectedChannelRow).not.toHaveBeenCalled()
  })

  it('cache unavailable: cache object lacks has/set methods → redirect with code=state_store_unavailable', async () => {
    mockContainerResolve.mockImplementation((token: string) => {
      if (token === 'cache') return { someOtherMethod: jest.fn() }
      if (token === 'em') return { fork: () => ({ findOne: jest.fn() }) }
      if (token === 'integrationCredentialsService') return null
      return undefined
    })

    const cookie = makeStateCookie()
    const req = buildRequest('?code=auth-code-999&state=test-state-nonce', cookie)
    const res = await GET(req, { params: { provider: PROVIDER } })

    expect(res.status).toBe(302)
    const location = res.headers.get('location')
    expect(location).toBeTruthy()
    expect(location).toContain('code=state_store_unavailable')
    expect(mockCreateConnectedChannelRow).not.toHaveBeenCalled()
  })
})
