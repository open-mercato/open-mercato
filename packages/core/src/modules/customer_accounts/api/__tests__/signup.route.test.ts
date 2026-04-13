import { POST } from '@open-mercato/core/modules/customer_accounts/api/signup'

const mockCheckAuthRateLimit = jest.fn()
const mockResolveTranslations = jest.fn()
const mockSendEmail = jest.fn()
const mockFindByEmail = jest.fn()
const mockCreateUser = jest.fn()
const mockCreateEmailVerification = jest.fn()
const mockEmitCustomerAccountsEvent = jest.fn()
const mockFindOneRole = jest.fn()
const mockPersist = jest.fn()
const mockPersistAndFlush = jest.fn()
const mockCreate = jest.fn()
const mockExecute = jest.fn()

const mockCustomerUserService = {
  findByEmail: mockFindByEmail,
  createUser: mockCreateUser,
}

const mockCustomerTokenService = {
  createEmailVerification: mockCreateEmailVerification,
}

const mockEm = {
  getConnection: () => ({ execute: mockExecute }),
  findOne: mockFindOneRole,
  create: mockCreate,
  persist: mockPersist,
  persistAndFlush: mockPersistAndFlush,
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerUserService') return mockCustomerUserService
    if (token === 'customerTokenService') return mockCustomerTokenService
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/ratelimit/helpers', () => ({
  rateLimitErrorSchema: {},
}))

jest.mock('@open-mercato/core/modules/customer_accounts/lib/rateLimiter', () => ({
  checkAuthRateLimit: jest.fn((args: unknown) => mockCheckAuthRateLimit(args)),
  customerSignupRateLimitConfig: {},
  customerSignupIpRateLimitConfig: {},
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => mockResolveTranslations()),
}))

jest.mock('@open-mercato/shared/lib/email/send', () => ({
  sendEmail: jest.fn((args: unknown) => mockSendEmail(args)),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn((...args: unknown[]) => mockEmitCustomerAccountsEvent(...args)),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/emails/CustomerSignupVerificationEmail', () => ({
  __esModule: true,
  default: jest.fn(() => '<verification-email />'),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/emails/CustomerExistingAccountEmail', () => ({
  __esModule: true,
  default: jest.fn(() => '<existing-account-email />'),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const existingUserId = '33333333-3333-4333-8333-333333333333'
const newUserId = '44444444-4444-4444-8444-444444444444'
const defaultRoleId = '55555555-5555-4555-8555-555555555555'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/customer_accounts/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/customer_accounts/signup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckAuthRateLimit.mockResolvedValue({ error: null })
    mockResolveTranslations.mockReturnValue({
      translate: (_key: string, fallback: string) => fallback,
    })
    mockSendEmail.mockResolvedValue(undefined)
    mockFindByEmail.mockResolvedValue(null)
    mockCreateEmailVerification.mockResolvedValue('verification-token')
    mockEmitCustomerAccountsEvent.mockResolvedValue(undefined)
    mockFindOneRole.mockResolvedValue(null)
    mockCreate.mockReturnValue({ id: 'user-role-link' })
    mockPersist.mockReturnValue(undefined)
    mockPersistAndFlush.mockResolvedValue(undefined)
    mockExecute.mockResolvedValue([{ slug: 'acme' }])
    mockCreateUser.mockResolvedValue({
      id: newUserId,
      email: 'new@example.com',
      displayName: 'New User',
    })
  })

  test('returns 202 for an existing email without creating another account', async () => {
    mockFindByEmail.mockResolvedValueOnce({
      id: existingUserId,
      email: 'existing@example.com',
      displayName: 'Existing User',
    })

    const res = await POST(makeRequest({
      email: 'existing@example.com',
      password: 'Secret123!',
      displayName: 'Probe User',
      tenantId,
      organizationId,
    }))
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body).toEqual({ ok: true })
    expect(mockCreateUser).not.toHaveBeenCalled()
    expect(mockCreateEmailVerification).not.toHaveBeenCalled()
    expect(mockEmitCustomerAccountsEvent).not.toHaveBeenCalled()
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })

  test('returns 202 for a new email and creates the account flow', async () => {
    mockFindOneRole.mockResolvedValueOnce({
      id: defaultRoleId,
      isDefault: true,
    })

    const res = await POST(makeRequest({
      email: 'new@example.com',
      password: 'Secret123!',
      displayName: 'New User',
      tenantId,
      organizationId,
    }))
    const body = await res.json()

    expect(res.status).toBe(202)
    expect(body).toEqual({ ok: true })
    expect(mockCreateUser).toHaveBeenCalledWith(
      'new@example.com',
      'Secret123!',
      'New User',
      { tenantId, organizationId },
    )
    expect(mockCreateEmailVerification).toHaveBeenCalledWith(newUserId, tenantId)
    expect(mockEmitCustomerAccountsEvent).toHaveBeenCalledWith('customer_accounts.user.created', {
      id: newUserId,
      email: 'new@example.com',
      tenantId,
      organizationId,
    })
    expect(mockSendEmail).toHaveBeenCalledTimes(1)
  })
})
