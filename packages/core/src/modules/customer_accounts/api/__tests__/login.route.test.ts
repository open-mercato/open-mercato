/**
 * @jest-environment node
 *
 * Regression coverage for issue #2694: the customer login handler must not leak
 * account existence through differential error responses or a bcrypt timing oracle.
 * Every failed-login branch (unknown email, missing hash, inactive, locked, wrong
 * password) must return the same generic 401 body and run a constant-time bcrypt
 * comparison so the response cannot be used to enumerate accounts per tenant.
 */
import { POST } from '@open-mercato/core/modules/customer_accounts/api/login'

jest.mock('@open-mercato/core/modules/customer_accounts/lib/tenantEligibility', () => ({
  isCustomerTenantActive: jest.fn(async () => true),
}))

const mockCheckAuthRateLimit = jest.fn()
const mockResolveTenantContext = jest.fn()
const mockFindByEmail = jest.fn()
const mockVerifyPassword = jest.fn()
const mockCheckLockout = jest.fn()
const mockIncrementFailedAttempts = jest.fn()
const mockResetFailedAttemptsUnlessLocked = jest.fn()
const mockCreateSession = jest.fn()
const mockBcryptCompare = jest.fn()
const mockEmitCustomerAccountsEvent = jest.fn()
const mockReportError = jest.fn()

const mockCustomerUserService = {
  findByEmail: mockFindByEmail,
  verifyPassword: mockVerifyPassword,
  checkLockout: mockCheckLockout,
  incrementFailedAttempts: mockIncrementFailedAttempts,
  resetFailedAttemptsUnlessLocked: mockResetFailedAttemptsUnlessLocked,
  updateLastLoginAt: jest.fn(async () => undefined),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerUserService') return mockCustomerUserService
    if (token === 'customerSessionService') return { createSession: mockCreateSession }
    if (token === 'customerRbacService') return { getEffectiveFeatures: jest.fn(async () => []) }
    return null
  }),
}

jest.mock('bcryptjs', () => ({
  compare: (...args: unknown[]) => mockBcryptCompare(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  rateLimitErrorSchema: {},
  getClientIp: jest.fn(() => '127.0.0.1'),
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
    status: number
    constructor(message: string, status = 400) {
      super(message)
      this.status = status
    }
  },
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn((...args: unknown[]) => mockEmitCustomerAccountsEvent(...args)),
}))

jest.mock('@open-mercato/shared/lib/telemetry/runtime', () => ({
  getTelemetryRuntime: () => ({ reportError: mockReportError }),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/customer_accounts/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return { email: 'probe@example.com', password: 'Secret123!', tenantId, ...overrides }
}

describe('POST /api/customer_accounts/login — account-enumeration hardening (#2694)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null, compoundKey: null })
    mockResolveTenantContext.mockResolvedValue({ tenantId })
    mockBcryptCompare.mockResolvedValue(false)
    mockCheckLockout.mockReturnValue(false)
    mockVerifyPassword.mockResolvedValue(false)
    mockEmitCustomerAccountsEvent.mockResolvedValue(undefined)
  })

  test('unknown email runs the bcrypt timing floor and returns generic 401', async () => {
    mockFindByEmail.mockResolvedValueOnce(null)

    const res = await POST(makeRequest(baseBody()))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ ok: false, error: 'Invalid email or password' })
    expect(mockBcryptCompare).toHaveBeenCalledWith('Secret123!', expect.stringMatching(/^\$2[aby]\$10\$/))
  })

  test('account with no password hash runs the bcrypt timing floor and returns generic 401', async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: true, passwordHash: null })

    const res = await POST(makeRequest(baseBody()))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ ok: false, error: 'Invalid email or password' })
    expect(mockBcryptCompare).toHaveBeenCalledTimes(1)
  })

  test('inactive account returns generic 401 (no "deactivated" disclosure) and pays the bcrypt floor', async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: false, passwordHash: 'hash' })

    const res = await POST(makeRequest(baseBody()))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ ok: false, error: 'Invalid email or password' })
    expect(body.error).not.toMatch(/deactivat/i)
    expect(mockBcryptCompare).toHaveBeenCalledTimes(1)
    expect(mockVerifyPassword).not.toHaveBeenCalled()
  })

  test('locked account returns generic 401 (not 423) and pays the bcrypt floor', async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: true, passwordHash: 'hash' })
    mockCheckLockout.mockReturnValueOnce(true)

    const res = await POST(makeRequest(baseBody()))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ ok: false, error: 'Invalid email or password' })
    expect(body.error).not.toMatch(/lock/i)
    expect(mockBcryptCompare).toHaveBeenCalledTimes(1)
    expect(mockVerifyPassword).not.toHaveBeenCalled()
  })

  test('wrong password for a real account returns the same generic 401 body', async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: true, passwordHash: 'hash', emailVerifiedAt: new Date() })
    mockVerifyPassword.mockResolvedValueOnce(false)

    const res = await POST(makeRequest(baseBody()))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ ok: false, error: 'Invalid email or password' })
    expect(mockIncrementFailedAttempts).toHaveBeenCalledTimes(1)
  })

  test('every failed branch yields an identical status + body (no observable difference)', async () => {
    const scenarios = [
      () => mockFindByEmail.mockResolvedValueOnce(null),
      () => mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: true, passwordHash: null }),
      () => mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: false, passwordHash: 'hash' }),
      () => {
        mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: true, passwordHash: 'hash' })
        mockCheckLockout.mockReturnValueOnce(true)
      },
      () => {
        mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: true, passwordHash: 'hash', emailVerifiedAt: new Date() })
        mockVerifyPassword.mockResolvedValueOnce(false)
      },
    ]

    const responses: { status: number; body: unknown }[] = []
    for (const setup of scenarios) {
      setup()
      const res = await POST(makeRequest(baseBody()))
      responses.push({ status: res.status, body: await res.json() })
    }

    const [first, ...rest] = responses
    for (const response of rest) {
      expect(response).toEqual(first)
    }
    expect(first).toEqual({ status: 401, body: { ok: false, error: 'Invalid email or password' } })
  })
})

describe('POST /api/customer_accounts/login — lockout under concurrent attempts (#7232)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null, compoundKey: null })
    mockResolveTenantContext.mockResolvedValue({ tenantId })
    mockCheckLockout.mockReturnValue(false)
    mockEmitCustomerAccountsEvent.mockResolvedValue(undefined)
  })

  test('refuses a correct password when a concurrent failure locked the account during its bcrypt check', async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: true, passwordHash: 'hash', emailVerifiedAt: new Date() })
    mockVerifyPassword.mockResolvedValueOnce(true)
    mockResetFailedAttemptsUnlessLocked.mockResolvedValueOnce(false)

    const res = await POST(makeRequest(baseBody()))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ ok: false, error: 'Invalid email or password' })
    expect(mockCreateSession).not.toHaveBeenCalled()
    expect(mockEmitCustomerAccountsEvent).toHaveBeenCalledWith(
      'customer_accounts.login.failed',
      { email: 'probe@example.com', reason: 'locked', tenantId },
    )
  })

  test('resets the counter through the lock-aware reset and signs in when no lock engaged', async () => {
    mockFindByEmail.mockResolvedValueOnce({ id: 'u1', isActive: true, passwordHash: 'hash', emailVerifiedAt: new Date() })
    mockVerifyPassword.mockResolvedValueOnce(true)
    mockResetFailedAttemptsUnlessLocked.mockResolvedValueOnce(true)
    mockCreateSession.mockResolvedValueOnce({ rawToken: 'raw-session-token', jwt: 'customer-jwt', session: { id: 's1' } })

    const res = await POST(makeRequest(baseBody()))

    expect(res.status).toBe(200)
    expect(mockResetFailedAttemptsUnlessLocked).toHaveBeenCalledWith(expect.objectContaining({ id: 'u1' }))
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
    expect(mockIncrementFailedAttempts).not.toHaveBeenCalled()
  })
})

describe('POST /api/customer_accounts/login — login event failures are reported', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null, compoundKey: null })
    mockResolveTenantContext.mockResolvedValue({ tenantId })
    mockBcryptCompare.mockResolvedValue(false)
    mockCheckLockout.mockReturnValue(false)
  })

  test('a rejected login.failed emit is reported through telemetry and keeps the generic 401', async () => {
    const emitError = new Error('event bus down')
    mockEmitCustomerAccountsEvent.mockRejectedValueOnce(emitError)
    mockFindByEmail.mockResolvedValueOnce(null)

    const res = await POST(makeRequest(baseBody()))
    await new Promise((resolve) => setImmediate(resolve))

    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ ok: false, error: 'Invalid email or password' })
    expect(mockReportError).toHaveBeenCalledWith(emitError, {
      module: 'customer_accounts',
      code: 'customer_accounts.login_event_failed',
    })
  })
})
