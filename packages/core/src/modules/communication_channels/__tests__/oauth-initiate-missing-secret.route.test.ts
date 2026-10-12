/** @jest-environment node */

import { POST as initiateOAuth } from '../api/post/oauth/[provider]/initiate/route'
import { createLogger } from '@open-mercato/shared/lib/logger'

const mockGetAuthFromRequest = jest.fn()
const mockResolveOAuthClientCredentials = jest.fn()
const mockReportError = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = { error: jest.fn(), child: jest.fn() }
  logger.child.mockReturnValue(logger)
  return { createLogger: jest.fn(() => logger) }
})

const mockLogger = jest.requireMock('@open-mercato/shared/lib/logger').createLogger('test') as {
  error: jest.Mock
  child: jest.Mock
}

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: jest.fn(() => ({ reportError: mockReportError })),
}))

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
    mockLogger.error.mockClear()
    mockReportError.mockClear()

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
    expect(JSON.stringify(body)).not.toContain('[internal]')
    expect(JSON.stringify(body)).not.toContain('OM_HUB_OAUTH_STATE_KEY')
    expect(JSON.stringify(body)).not.toContain('KMS_MASTER_KEY')
  })

  test('logs and reports the missing state secret once', async () => {
    await initiateOAuth(makeRequest(), { params: { provider: PROVIDER } })

    expect(createLogger).toHaveBeenCalledWith('communication_channels')
    expect(mockLogger.child).toHaveBeenCalledWith({ component: 'oauth-initiate' })
    expect(mockLogger.error).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledTimes(1)
    expect(mockReportError).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'missing_secret' }),
      expect.objectContaining({ module: 'communication_channels', code: 'communication_channels.missing_secret' }),
    )
  })
})
