/** @jest-environment node */

const mockGetAuth = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockFindById = jest.fn()
const mockUpdatePassword = jest.fn()
const mockRevokeAllUserSessions = jest.fn()
const mockTransactional = jest.fn(async (cb: (trx: unknown) => Promise<unknown>) => cb({}))
const mockEmit = jest.fn(async () => undefined)

const rbacService = { userHasAllFeatures: mockUserHasAllFeatures }

const customerUserService = {
  findById: mockFindById,
  updatePassword: mockUpdatePassword,
}

const customerSessionService = {
  revokeAllUserSessions: mockRevokeAllUserSessions,
}

const mockEm = {
  transactional: (cb: (trx: unknown) => Promise<unknown>) => mockTransactional(cb),
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return rbacService
    if (token === 'customerUserService') return customerUserService
    if (token === 'customerSessionService') return customerSessionService
    if (token === 'em') return mockEm
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuth(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: (...args: unknown[]) => mockEmit(...args),
}))

import { POST } from '@open-mercato/core/modules/customer_accounts/api/admin/users/[id]/reset-password'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '33333333-3333-4333-8333-333333333333'
const adminId = '44444444-4444-4444-8444-444444444444'
const userId = '22222222-2222-4222-8222-222222222222'

function makeRequest(body: Record<string, unknown>) {
  return new Request(`http://localhost/api/customer_accounts/admin/users/${userId}/reset-password`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('admin /api/customer_accounts/admin/users/[id]/reset-password — atomicity and audit events', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockFindById.mockResolvedValue({ id: userId, tenantId, organizationId: orgId, email: 'user@example.com' })
    mockUpdatePassword.mockResolvedValue(undefined)
    mockRevokeAllUserSessions.mockResolvedValue(undefined)
    mockTransactional.mockImplementation(async (cb) => cb({}))
    mockEmit.mockResolvedValue(undefined)
  })

  it('runs updatePassword + revokeAllUserSessions inside em.transactional and emits both password.reset and password.changed after commit', async () => {
    const res = await POST(
      makeRequest({ newPassword: 'new-strong-Passw0rd!' }),
      { params: { id: userId } },
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mockTransactional).toHaveBeenCalledTimes(1)
    expect(mockUpdatePassword).toHaveBeenCalledTimes(1)
    expect(mockRevokeAllUserSessions).toHaveBeenCalledTimes(1)
    expect(mockEmit).toHaveBeenCalledTimes(2)

    const txOrder = mockTransactional.mock.invocationCallOrder[0]
    const firstEmitOrder = mockEmit.mock.invocationCallOrder[0]
    expect(txOrder).toBeLessThan(firstEmitOrder)

    const emittedIds = mockEmit.mock.calls.map((c: unknown[]) => c[0])
    expect(emittedIds).toContain('customer_accounts.password.reset')
    expect(emittedIds).toContain('customer_accounts.password.changed')

    const changedCall = mockEmit.mock.calls.find((c: unknown[]) => c[0] === 'customer_accounts.password.changed')
    expect(changedCall).toBeDefined()
    const payload = changedCall![1] as Record<string, unknown>
    expect(payload).toMatchObject({
      userId,
      tenantId,
      organizationId: orgId,
      changedBy: 'admin',
      changedById: adminId,
    })
    expect(typeof payload.at).toBe('string')
    expect(() => new Date(payload.at as string).toISOString()).not.toThrow()
  })

  it('does NOT emit any audit event when the transaction rolls back because revokeAllUserSessions throws', async () => {
    mockRevokeAllUserSessions.mockRejectedValue(new Error('boom'))

    await expect(
      POST(
        makeRequest({ newPassword: 'new-strong-Passw0rd!' }),
        { params: { id: userId } },
      ),
    ).rejects.toThrow('boom')

    expect(mockUpdatePassword).toHaveBeenCalledTimes(1)
    expect(mockRevokeAllUserSessions).toHaveBeenCalledTimes(1)
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('does NOT run the transaction or emit when the caller is not authenticated', async () => {
    mockGetAuth.mockResolvedValue(null)

    const res = await POST(
      makeRequest({ newPassword: 'new-strong-Passw0rd!' }),
      { params: { id: userId } },
    )

    expect(res.status).toBe(401)
    expect(mockTransactional).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('does NOT run the transaction or emit when the caller lacks customer_accounts.manage', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)

    const res = await POST(
      makeRequest({ newPassword: 'new-strong-Passw0rd!' }),
      { params: { id: userId } },
    )

    expect(res.status).toBe(403)
    expect(mockTransactional).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('does NOT run the transaction or emit when the target user cannot be found', async () => {
    mockFindById.mockResolvedValue(null)

    const res = await POST(
      makeRequest({ newPassword: 'new-strong-Passw0rd!' }),
      { params: { id: userId } },
    )

    expect(res.status).toBe(404)
    expect(mockTransactional).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })

  it('does NOT run the transaction or emit when the body fails validation', async () => {
    const res = await POST(
      makeRequest({ newPassword: 'x' }),
      { params: { id: userId } },
    )

    expect(res.status).toBe(400)
    expect(mockTransactional).not.toHaveBeenCalled()
    expect(mockEmit).not.toHaveBeenCalled()
  })
})
