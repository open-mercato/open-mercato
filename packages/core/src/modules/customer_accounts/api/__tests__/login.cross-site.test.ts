/**
 * @jest-environment node
 */
import { POST } from '@open-mercato/core/modules/customer_accounts/api/login'

jest.mock('@open-mercato/core/modules/customer_accounts/lib/tenantEligibility', () => ({
  isCustomerTenantActive: jest.fn(async () => true),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const userId = '33333333-3333-4333-8333-333333333333'

const mockCheckAuthRateLimit = jest.fn()
const mockResolveTenantContext = jest.fn()
const mockFindByEmail = jest.fn()
const mockVerifyPassword = jest.fn()
const mockCreateSession = jest.fn()

const mockCustomerUserService = {
  findByEmail: mockFindByEmail,
  verifyPassword: mockVerifyPassword,
  checkLockout: jest.fn(() => false),
  incrementFailedAttempts: jest.fn(),
  resetFailedAttemptsUnlessLocked: jest.fn(async () => true),
  updateLastLoginAt: jest.fn(async () => undefined),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerUserService') return mockCustomerUserService
    if (token === 'customerSessionService') return { createSession: mockCreateSession }
    if (token === 'customerRbacService') return { getEffectiveFeatures: jest.fn(async () => ['portal.view']) }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? '',
  }),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: jest.fn((args: unknown) => mockCheckAuthRateLimit(args)),
  resetAuthRateLimit: jest.fn(),
  customerLoginRateLimitConfig: {},
  customerLoginIpRateLimitConfig: {},
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/resolveTenantContext', () => ({
  resolveTenantContext: jest.fn((...args: unknown[]) => mockResolveTenantContext(...args)),
  TenantResolutionError: class TenantResolutionError extends Error {
    status = 400
  },
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn(async () => undefined),
}))

const ORIGINAL_ENV = {
  APP_URL: process.env.APP_URL,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  APP_ALLOWED_ORIGINS: process.env.APP_ALLOWED_ORIGINS,
}

function restoreEnv() {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

const credentials = { email: 'attacker@example.com', password: 'Attacker-Secret-1!', tenantId }

function buildLoginRequest(options: { url?: string; headers?: Record<string, string>; body?: string } = {}) {
  return new Request(options.url ?? 'http://localhost:3000/api/customer_accounts/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: 'localhost:3000',
      ...(options.headers ?? {}),
    },
    body: options.body ?? JSON.stringify(credentials),
  })
}

function textPlainFormBody(): string {
  const prefix = JSON.stringify(credentials).slice(0, -1)
  return `${prefix},"padding":"=x"}`
}

async function expectRejectedWithoutSession(res: Response) {
  expect(res.status).toBe(403)
  const body = await res.json()
  expect(body.ok).toBe(false)
  expect(typeof body.error).toBe('string')
  const setCookie = res.headers.get('set-cookie') ?? ''
  expect(setCookie).not.toContain('customer_auth_token=')
  expect(setCookie).not.toContain('customer_session_token=')
  expect(mockCheckAuthRateLimit).not.toHaveBeenCalled()
  expect(mockResolveTenantContext).not.toHaveBeenCalled()
  expect(mockFindByEmail).not.toHaveBeenCalled()
  expect(mockCreateSession).not.toHaveBeenCalled()
}

async function expectSessionIssued(res: Response) {
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.ok).toBe(true)
  expect(res.headers.get('set-cookie') ?? '').toContain('customer_auth_token=')
  expect(mockCreateSession).toHaveBeenCalledTimes(1)
}

describe('POST /api/customer_accounts/login — cross-site browser submissions (#7239)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    restoreEnv()
    delete process.env.APP_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.APP_ALLOWED_ORIGINS
    mockCheckAuthRateLimit.mockResolvedValue({ error: null, compoundKey: null })
    mockResolveTenantContext.mockResolvedValue({ tenantId })
    mockFindByEmail.mockResolvedValue({
      id: userId,
      email: credentials.email,
      displayName: 'Attacker',
      passwordHash: 'hash',
      isActive: true,
      emailVerifiedAt: new Date(),
      organizationId,
    })
    mockVerifyPassword.mockResolvedValue(true)
    mockCreateSession.mockResolvedValue({ rawToken: 'raw-session-token', jwt: 'customer-jwt', session: { id: 'session-1' } })
  })

  afterAll(() => {
    restoreEnv()
  })

  describe('rejects', () => {
    test('a text/plain cross-site form whose body parses as JSON', async () => {
      const res = await POST(buildLoginRequest({
        headers: {
          'content-type': 'text/plain',
          origin: 'https://evil.example',
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'navigate',
        },
        body: textPlainFormBody(),
      }))
      await expectRejectedWithoutSession(res)
    })

    test('a foreign Origin from a browser that does not send Fetch Metadata', async () => {
      const res = await POST(buildLoginRequest({ headers: { origin: 'https://evil.example' } }))
      await expectRejectedWithoutSession(res)
    })

    test('an opaque Origin: null', async () => {
      const res = await POST(buildLoginRequest({ headers: { origin: 'null' } }))
      await expectRejectedWithoutSession(res)
    })
  })

  describe('keeps working', () => {
    test('the first-party portal login page (same-origin JSON fetch)', async () => {
      const res = await POST(buildLoginRequest({
        headers: { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-origin', 'sec-fetch-mode': 'cors' },
      }))
      await expectSessionIssued(res)
    })

    test('a portal custom domain whose Origin matches the request Host', async () => {
      process.env.APP_URL = 'https://app.example.com'
      const res = await POST(buildLoginRequest({
        url: 'https://shop.acme.test/api/customer_accounts/login',
        headers: { host: 'shop.acme.test', origin: 'https://shop.acme.test' },
      }))
      await expectSessionIssued(res)
    })

    test('non-browser clients that send neither Origin nor Sec-Fetch-Site', async () => {
      const res = await POST(buildLoginRequest())
      await expectSessionIssued(res)
    })
  })
})
