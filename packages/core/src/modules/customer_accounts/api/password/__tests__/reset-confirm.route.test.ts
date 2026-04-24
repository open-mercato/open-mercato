/** @jest-environment node */

const mockVerifyPasswordResetToken = jest.fn()
const mockFindById = jest.fn()
const mockUpdatePassword = jest.fn()
const mockRevokeAllUserSessions = jest.fn()
const mockNativeUpdate = jest.fn()
const mockTransactional = jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb({}))
const mockEmit = jest.fn(async () => undefined)

const customerTokenService = {
  verifyPasswordResetToken: mockVerifyPasswordResetToken,
}

const customerUserService = {
  findById: mockFindById,
  updatePassword: mockUpdatePassword,
}

const customerSessionService = {
  revokeAllUserSessions: mockRevokeAllUserSessions,
}

const mockEm = {
  transactional: (cb: (trx: unknown) => Promise<unknown>) => mockTransactional(cb),
  nativeUpdate: (...args: unknown[]) => mockNativeUpdate(...args),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerTokenService') return customerTokenService
    if (token === 'customerUserService') return customerUserService
    if (token === 'customerSessionService') return customerSessionService
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

import { POST } from '@open-mercato/core/modules/customer_accounts/api/password/reset-confirm'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '33333333-3333-4333-8333-333333333333'
const userId = '22222222-2222-4222-8222-222222222222'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/customer_accounts/password/reset-confirm', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('customer /api/customer_accounts/password/reset-confirm — atomicity and audit event', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyPasswordResetToken.mockResolvedValue({ userId, tenantId })
    mockFindById.mockResolvedValue({ id: userId, tenantId, organizationId: orgId, email: 'user@example.com' })
    mockUpdatePassword.mockResolvedValue(undefined)
    mockRevokeAllUserSessions.mockResolvedValue(undefined)
    mockNativeUpdate.mockResolvedValue(undefined)
    mockTransactional.mockImplementation(async (cb) => cb({}))
    mockEmit.mockResolvedValue(undefined)
  })

  it('runs updatePassword + revokeAllUserSessions inside em.transactional and emits the audit event after commit', async () => {
    const res = await POST(
      makeRequest({ token: 'a'.repeat(40), password: 'new-strong-Passw0rd!' }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mockTransactional).toHaveBeenCalledTimes(1)
    expect(mockUpdatePassword).toHaveBeenCalledTimes(1)
    expect(mockRevokeAllUserSessions).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledTimes(1)

    const txOrder = mockTransactional.mock.invocationCallOrder[0]
    const emitOrder = mockEmit.mock.invocationCallOrder[0]
    expect(txOrder).toBeLessThan(emitOrder)

    const [eventId, payload] = mockEmit.mock.calls[0]
    expect(eventId).toBe('customer_accounts.password.changed')
    expect(payload).toMatchObject({
      userId,
      tenantId,
      organizationId: orgId,
      changedBy: 'reset',
      changedById: null,
    })
    expect(typeof payload.at).toBe('string')
    expect(() => new Date(payload.at).toISOString()).not.toThrow()
  })

  it('does NOT emit the audit event when the transaction rolls back because revokeAllUserSessions throws', async () => {
    mockRevokeAllUserSessions.mockRejectedValue(new Error('boom'))

    await expect(
      POST(makeRequest({ token: 'a'.repeat(40), password: 'new-strong-Passw0rd!' })),
    ).rejects.toThrow('boom')

    expect(mockUpdatePassword).toHaveBeenCalledTimes(1)
    expect(mockRevokeAllUserSessions).toHaveBeenCalledTimes(1)
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('does NOT emit the audit event when the token is invalid', async () => {
    mockVerifyPasswordResetToken.mockResolvedValue(null)

    const res = await POST(
      makeRequest({ token: 'a'.repeat(40), password: 'new-strong-Passw0rd!' }),
    )

    expect(res.status).toBe(400)
    expect(mockTransactional).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('does NOT emit the audit event when the user cannot be found after token verification', async () => {
    mockFindById.mockResolvedValue(null)

    const res = await POST(
      makeRequest({ token: 'a'.repeat(40), password: 'new-strong-Passw0rd!' }),
    )

    expect(res.status).toBe(404)
    expect(mockTransactional).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('does NOT emit the audit event when the request body fails validation', async () => {
    const res = await POST(makeRequest({ token: '', password: 'x' }))

    expect(res.status).toBe(400)
    expect(mockTransactional).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
