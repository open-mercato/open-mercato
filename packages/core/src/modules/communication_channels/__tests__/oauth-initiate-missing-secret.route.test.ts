/** @jest-environment node */

import { POST as initiateOAuth } from '../api/post/oauth/[provider]/initiate/route'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOAuthClientCredentials = jest.fn()

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ORG_ID = '223e4567-e89b-12d3-a456-426614174001'
const PROVIDER = 'gmail'

const mockContainer = {
  resolve: jest.fn(() => {
    throw new Error('[internal] unexpected DI token')
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((request: Request) => mockGetAuthFromRequest(request)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('../lib/adapter-registry-singleton', () => ({
  getChannelAdapter: jest.fn(() => ({
    buildOAuthAuthorizeUrl: jest.fn(async () => ({ authorizeUrl: 'https://example.test/authorize' })),
  })),
}))

jest.mock('../lib/oauth-client-config', () => ({
  resolveOAuthClientCredentials: jest.fn((...args: unknown[]) => mockResolveOAuthClientCredentials(...args)),
}))

function makeRequest(): Request {
  return new Request(`http://localhost/api/communication_channels/oauth/${PROVIDER}/initiate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
}

describe('communication_channels oauth initiate — missing state secret in production', () => {
  const saved = {
    stateKey: process.env.OM_HUB_OAUTH_STATE_KEY,
    kms: process.env.KMS_MASTER_KEY,
    jwt: process.env.JWT_SECRET,
    nodeEnv: process.env.NODE_ENV,
  }

  beforeEach(() => {
    mockGetAuthFromRequest.mockReset()
    mockResolveOAuthClientCredentials.mockReset()
    mockContainer.resolve.mockClear()

    mockGetAuthFromRequest.mockResolvedValue({
      sub: 'user-1',
      tenantId: TENANT_ID,
      orgId: ORG_ID,
      isSuperAdmin: false,
      roles: ['admin'],
    })
    mockResolveOAuthClientCredentials.mockResolvedValue({
      clientId: 'client-id',
      clientSecret: 'client-secret',
    })

    delete process.env.OM_HUB_OAUTH_STATE_KEY
    delete process.env.KMS_MASTER_KEY
    delete process.env.JWT_SECRET
    process.env.NODE_ENV = 'production'
  })

  afterEach(() => {
    if (saved.stateKey !== undefined) process.env.OM_HUB_OAUTH_STATE_KEY = saved.stateKey
    else delete process.env.OM_HUB_OAUTH_STATE_KEY
    if (saved.kms !== undefined) process.env.KMS_MASTER_KEY = saved.kms
    else delete process.env.KMS_MASTER_KEY
    if (saved.jwt !== undefined) process.env.JWT_SECRET = saved.jwt
    else delete process.env.JWT_SECRET
    if (saved.nodeEnv !== undefined) process.env.NODE_ENV = saved.nodeEnv
    else delete process.env.NODE_ENV
  })

  test('returns a JSON 500 instead of a bodyless crash', async () => {
    const response = await initiateOAuth(makeRequest(), { params: { provider: PROVIDER } })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.code).toBe('missing_secret')
    expect(typeof body.error).toBe('string')
    expect(body.error.length).toBeGreaterThan(0)
  })
})
