import { POST } from '@open-mercato/core/modules/auth/api/users/resend-invite/route'

const mockGetAuthFromRequest = jest.fn()
const mockLoadAcl = jest.fn()
const mockSendEmail = jest.fn()
const mockFindOne = jest.fn()
const mockCreate = jest.fn()
const mockPersistAndFlush = jest.fn()
const mockNativeUpdate = jest.fn()
const mockValidateCrudMutationGuard = jest.fn()
const mockRunCrudMutationGuardAfterSuccess = jest.fn()
const mockCheckAuthRateLimit = jest.fn()

const mockEm = {
  findOne: mockFindOne,
  create: mockCreate,
  persistAndFlush: mockPersistAndFlush,
  nativeUpdate: mockNativeUpdate,
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return { loadAcl: mockLoadAcl }
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn((args: unknown) => mockSendEmail(args)),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (key: string, fallback: string) => fallback,
  })),
}))

jest.mock('@open-mercato/core/modules/auth/emails/InviteUserEmail', () => ({
  __esModule: true,
  default: jest.fn(() => '<email />'),
}))

const __readJsonBody: { current: Record<string, unknown> } = { current: {} }
;(globalThis as any).__readJsonBody = __readJsonBody
jest.mock('@open-mercato/shared/lib/http/readJsonSafe', () => ({
  readJsonSafe: jest.fn(async () => (globalThis as any).__readJsonBody.current),
}))

jest.mock('@open-mercato/core/modules/auth/lib/rateLimitCheck', () => ({
  checkAuthRateLimit: jest.fn((args: unknown) => mockCheckAuthRateLimit(args)),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/config', () => ({
  readEndpointRateLimitConfig: jest.fn(() => ({})),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  rateLimitErrorSchema: {},
}))

jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn((...args: unknown[]) => mockValidateCrudMutationGuard(...args)),
  runCrudMutationGuardAfterSuccess: jest.fn((...args: unknown[]) => mockRunCrudMutationGuardAfterSuccess(...args)),
}))

const tenantA = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0'
const tenantB = 'b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0'
const userId = 'c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c0'
const actorId = 'd0d0d0d0-d0d0-4d0d-8d0d-d0d0d0d0d0d0'
const orgId = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0'
const originalEnv = process.env

function makeRequest(body: Record<string, unknown>, url = 'http://localhost/api/auth/users/resend-invite') {
  __readJsonBody.current = body
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: userId,
    email: 'invited@example.com',
    tenantId: tenantA,
    organizationId: orgId,
    passwordHash: null,
    ...overrides,
  }
}

describe('POST /api/auth/users/resend-invite', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    process.env = {
      ...originalEnv,
      APP_URL: undefined,
      NEXT_PUBLIC_APP_URL: undefined,
      APP_ALLOWED_ORIGINS: undefined,
    }
    mockGetAuthFromRequest.mockResolvedValue({
      sub: actorId,
      tenantId: tenantA,
      orgId,
    })
    mockLoadAcl.mockResolvedValue({ isSuperAdmin: false })
    mockCheckAuthRateLimit.mockResolvedValue({ error: null })
    mockValidateCrudMutationGuard.mockResolvedValue(null)
    mockFindOne.mockResolvedValue(makeUser())
    mockCreate.mockReturnValue({ id: 'new-token-row' })
    mockPersistAndFlush.mockResolvedValue(undefined)
    mockNativeUpdate.mockResolvedValue(undefined)
    mockSendEmail.mockResolvedValue(undefined)
  })

  afterAll(() => {
    process.env = originalEnv
  })

  test('returns 401 when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce(null)
    const res = await POST(makeRequest({ id: userId }))
    expect(res.status).toBe(401)
  })

  test('returns 422 for invalid UUID', async () => {
    const res = await POST(makeRequest({ id: 'not-a-uuid' }))
    expect(res.status).toBe(422)
  })

  test('returns 404 when non-superadmin targets a user in another tenant', async () => {
    mockGetAuthFromRequest.mockResolvedValueOnce({
      sub: actorId,
      tenantId: tenantA,
      orgId,
    })
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: false })
    mockFindOne.mockResolvedValueOnce(null)

    const res = await POST(makeRequest({ id: userId }))
    expect(res.status).toBe(404)

    const whereArg = mockFindOne.mock.calls[0]?.[1] as Record<string, unknown>
    expect(whereArg.tenantId).toBe(tenantA)
  })

  test('superadmin can resend for any tenant user (no tenant filter)', async () => {
    mockLoadAcl.mockResolvedValueOnce({ isSuperAdmin: true })
    mockFindOne.mockResolvedValueOnce(makeUser({ tenantId: tenantB }))

    const res = await POST(makeRequest({ id: userId }))
    expect(res.status).toBe(200)

    const whereArg = mockFindOne.mock.calls[0]?.[1] as Record<string, unknown>
    expect(whereArg).not.toHaveProperty('tenantId')
  })

  test('returns 409 when user already has a password', async () => {
    mockFindOne.mockResolvedValueOnce(makeUser({ passwordHash: '$2a$10$somehash' }))

    const res = await POST(makeRequest({ id: userId }))
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/password/i)
  })

  test('invalidates prior unused tokens before creating new one', async () => {
    const res = await POST(makeRequest({ id: userId }))
    expect(res.status).toBe(200)

    expect(mockNativeUpdate).toHaveBeenCalledTimes(1)
    const [, where] = mockNativeUpdate.mock.calls[0]
    expect(where).toMatchObject({ user: userId, usedAt: null })

    expect(mockPersistAndFlush).toHaveBeenCalledTimes(1)
  })

  test('creates token and sends email on success', async () => {
    const res = await POST(makeRequest({ id: userId }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body).not.toHaveProperty('warning')
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  test('returns ok with warning when email fails', async () => {
    mockSendEmail.mockRejectedValueOnce(new Error('SMTP failure'))

    const res = await POST(makeRequest({ id: userId }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.warning).toBe('invite_email_failed')
  })

  test('rejects when mutation guard blocks', async () => {
    mockValidateCrudMutationGuard.mockResolvedValueOnce({
      ok: false,
      status: 423,
      body: { error: 'Record locked' },
    })

    const res = await POST(makeRequest({ id: userId }))
    expect(res.status).toBe(423)
    const body = await res.json()
    expect(body.error).toBe('Record locked')
    expect(mockPersistAndFlush).not.toHaveBeenCalled()
  })

  test('rejects a poisoned host before rotating invite tokens', async () => {
    process.env = {
      ...process.env,
      APP_URL: 'https://app.example.com',
    }

    const res = await POST(makeRequest({ id: userId }, 'https://evil.example/api/auth/users/resend-invite'))
    const body = await res.json()

    expect(res.status).toBe(400)
    expect(body.error).toBe('Invalid request origin')
    expect(mockNativeUpdate).not.toHaveBeenCalled()
    expect(mockPersistAndFlush).not.toHaveBeenCalled()
    expect(mockSendEmail).not.toHaveBeenCalled()
  })

  test('allows loopback origin mismatches outside production', async () => {
    process.env = {
      ...process.env,
      APP_URL: 'http://localhost:3000',
      NODE_ENV: 'test',
    }

    const res = await POST(makeRequest({ id: userId }, 'http://127.0.0.1:5001/api/auth/users/resend-invite'))

    expect(res.status).toBe(200)
    expect(mockNativeUpdate).toHaveBeenCalledTimes(1)
    expect(mockPersistAndFlush).toHaveBeenCalledTimes(1)
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })
})
