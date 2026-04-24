/** @jest-environment node */

const mockGetCustomerAuth = jest.fn()
const mockFindById = jest.fn()
const mockVerifyPassword = jest.fn()
const mockUpdatePassword = jest.fn()
const mockRevokeAllUserSessions = jest.fn()

const customerUserService = {
  findById: mockFindById,
  verifyPassword: mockVerifyPassword,
  updatePassword: mockUpdatePassword,
}

const customerSessionService = {
  revokeAllUserSessions: mockRevokeAllUserSessions,
}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'customerUserService') return customerUserService
    if (token === 'customerSessionService') return customerSessionService
    return null
  }),
}

jest.mock('@open-mercato/core/modules/customer_accounts/lib/customerAuth', () => ({
  getCustomerAuthFromRequest: jest.fn((req: Request) => mockGetCustomerAuth(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

import { POST } from '@open-mercato/core/modules/customer_accounts/api/portal/password-change'

const tenantId = '11111111-1111-4111-8111-111111111111'
const userId = '22222222-2222-4222-8222-222222222222'

function makeRequest(body: Record<string, unknown>) {
  return new Request('http://localhost/api/customer_accounts/portal/password-change', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('portal /api/customer_accounts/portal/password-change — session revocation on self-service password change', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetCustomerAuth.mockResolvedValue({ sub: userId, tenantId })
    mockFindById.mockResolvedValue({ id: userId, email: 'user@example.com' })
    mockVerifyPassword.mockResolvedValue(true)
    mockUpdatePassword.mockResolvedValue(undefined)
    mockRevokeAllUserSessions.mockResolvedValue(undefined)
  })

  it('revokes all existing sessions after a successful password change', async () => {
    const res = await POST(
      makeRequest({ currentPassword: 'old-correct-Passw0rd!', newPassword: 'new-strong-Passw0rd!' }),
    )
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(mockUpdatePassword).toHaveBeenCalledTimes(1)
    expect(mockRevokeAllUserSessions).toHaveBeenCalledTimes(1)
    expect(mockRevokeAllUserSessions).toHaveBeenCalledWith(userId)
  })

  it('revokes sessions AFTER updatePassword, never before (ordering invariant)', async () => {
    await POST(
      makeRequest({ currentPassword: 'old-correct-Passw0rd!', newPassword: 'new-strong-Passw0rd!' }),
    )

    const updateOrder = mockUpdatePassword.mock.invocationCallOrder[0]
    const revokeOrder = mockRevokeAllUserSessions.mock.invocationCallOrder[0]
    expect(updateOrder).toBeLessThan(revokeOrder)
  })

  it('does NOT revoke sessions when the current password is incorrect', async () => {
    mockVerifyPassword.mockResolvedValue(false)

    const res = await POST(
      makeRequest({ currentPassword: 'wrong', newPassword: 'new-strong-Passw0rd!' }),
    )

    expect(res.status).toBe(400)
    expect(mockUpdatePassword).not.toHaveBeenCalled()
    expect(mockRevokeAllUserSessions).not.toHaveBeenCalled()
  })

  it('does NOT revoke sessions when the caller is not authenticated', async () => {
    mockGetCustomerAuth.mockResolvedValue(null)

    const res = await POST(
      makeRequest({ currentPassword: 'any-Passw0rd!', newPassword: 'new-strong-Passw0rd!' }),
    )

    expect(res.status).toBe(401)
    expect(mockUpdatePassword).not.toHaveBeenCalled()
    expect(mockRevokeAllUserSessions).not.toHaveBeenCalled()
  })

  it('does NOT revoke sessions when the authenticated user cannot be found', async () => {
    mockFindById.mockResolvedValue(null)

    const res = await POST(
      makeRequest({ currentPassword: 'any-Passw0rd!', newPassword: 'new-strong-Passw0rd!' }),
    )

    expect(res.status).toBe(404)
    expect(mockUpdatePassword).not.toHaveBeenCalled()
    expect(mockRevokeAllUserSessions).not.toHaveBeenCalled()
  })

  it('does NOT revoke sessions when the request body fails validation', async () => {
    const res = await POST(
      makeRequest({ currentPassword: 'short', newPassword: 'x' }),
    )

    expect(res.status).toBe(400)
    expect(mockUpdatePassword).not.toHaveBeenCalled()
    expect(mockRevokeAllUserSessions).not.toHaveBeenCalled()
  })
})
