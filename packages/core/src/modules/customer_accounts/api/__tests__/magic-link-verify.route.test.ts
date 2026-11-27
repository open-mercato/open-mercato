/** @jest-environment node */
import { POST } from '@open-mercato/core/modules/customer_accounts/api/magic-link/verify'
import { AdvisoryLockUnavailableError } from '@open-mercato/shared/lib/db/advisoryLock'

const mockVerifyEmailToken = jest.fn()
const mockFindById = jest.fn()
const mockCreateSession = jest.fn()
const mockEmitCustomerAccountsEvent = jest.fn(async () => undefined)

const mockServices: Record<string, unknown> = {
  customerTokenService: { verifyEmailToken: mockVerifyEmailToken },
  customerUserService: {
    findById: mockFindById,
    resetFailedAttempts: jest.fn(),
    updateLastLoginAt: jest.fn(),
  },
  customerSessionService: { createSession: mockCreateSession },
  customerRbacService: { getEffectiveFeatures: jest.fn(async () => []) },
  em: {},
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (name: string) => mockServices[name],
  }),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: async () => ({
    translate: (key: string) => `translated:${key}`,
  }),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: () => mockEmitCustomerAccountsEvent(),
}))

function verifyRequest(): Request {
  return new Request('http://localhost/api/customer_accounts/magic-link/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'synthetic-magic-link' }),
  })
}

describe('POST /api/customer_accounts/magic-link/verify — session issuance failures', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyEmailToken.mockResolvedValueOnce({ userId: 'u1', tenantId: 't1' }).mockResolvedValue(null)
    mockFindById.mockResolvedValue({ id: 'u1', tenantId: 't1', isActive: true, emailVerifiedAt: new Date() })
  })

  test.each(['deadline', 'transient_db'] as const)('requires a fresh sign-in after consuming the magic link for %s', async (reason) => {
    mockCreateSession.mockRejectedValueOnce(new AdvisoryLockUnavailableError(reason, 'synthetic-lock-key'))

    const res = await POST(verifyRequest())

    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toBeNull()
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('set-cookie')).toBeNull()
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'translated:customer_accounts.errors.busy' })
    expect(mockFindById).toHaveBeenCalledWith('u1', 't1')
    expect(mockEmitCustomerAccountsEvent).not.toHaveBeenCalled()

    expect((await POST(verifyRequest())).status).toBe(400)
    expect(mockCreateSession).toHaveBeenCalledTimes(1)
  })

  test.each([
    new AdvisoryLockUnavailableError('commit_unknown', 'synthetic-lock-key'),
    new Error('Unrelated session failure'),
  ])('leaves %s to the API error handler', async (error) => {
    mockCreateSession.mockRejectedValueOnce(error)

    await expect(POST(verifyRequest())).rejects.toBe(error)
    expect(mockEmitCustomerAccountsEvent).not.toHaveBeenCalled()
  })
})
