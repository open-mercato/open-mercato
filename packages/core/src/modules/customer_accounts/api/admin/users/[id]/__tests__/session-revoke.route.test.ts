/** @jest-environment node */

import { CustomerUser, CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'

const mockGetAuth = jest.fn()
const mockUserHasAllFeatures = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockRevokeSession = jest.fn(async () => undefined)
const mockEm = {}

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'rbacService') return { userHasAllFeatures: mockUserHasAllFeatures }
    if (token === 'customerSessionService') return { revokeSession: mockRevokeSession }
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

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

import { DELETE, openApi } from '@open-mercato/core/modules/customer_accounts/api/admin/users/[id]/sessions/[sessionId]'

const tenantId = '11111111-1111-4111-8111-111111111111'
const orgId = '22222222-2222-4222-8222-222222222222'
const adminId = '44444444-4444-4444-8444-444444444444'
const userId = '55555555-5555-4555-8555-555555555555'
const sessionId = '66666666-6666-4666-8666-666666666666'
const otherSessionId = '77777777-7777-4777-8777-777777777777'

const user = { id: userId, tenantId, organizationId: orgId }
const session = { id: sessionId, user: userId }

function buildRequest(targetUserId: string, targetSessionId: string) {
  return new Request(
    `http://localhost/api/customer_accounts/admin/users/${targetUserId}/sessions/${targetSessionId}`,
    { method: 'DELETE' },
  )
}

async function callDelete(targetUserId = userId, targetSessionId = sessionId) {
  return DELETE(buildRequest(targetUserId, targetSessionId), {
    params: { id: targetUserId, sessionId: targetSessionId },
  })
}

describe('DELETE /api/customer_accounts/admin/users/[id]/sessions/[sessionId]', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId })
    mockUserHasAllFeatures.mockResolvedValue(true)
    mockFindOneWithDecryption.mockImplementation(async (
      _em: unknown,
      entity: unknown,
      where: Record<string, unknown>,
    ) => {
      if (entity === CustomerUser) {
        return where.id === userId && where.tenantId === tenantId && where.organizationId === orgId ? user : null
      }
      if (entity === CustomerUserSession) {
        return where.id === sessionId && where.user === userId && where.deletedAt === null ? session : null
      }
      return null
    })
  })

  it('revokes an active session of a customer user in the admin organization', async () => {
    const res = await callDelete()

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true })
    expect(mockUserHasAllFeatures).toHaveBeenCalledWith(adminId, ['customer_accounts.manage'], { tenantId, organizationId: orgId })
    expect(mockRevokeSession).toHaveBeenCalledWith(sessionId)
  })

  it('scopes the user lookup to the admin tenant and organization', async () => {
    await callDelete()

    const userCall = mockFindOneWithDecryption.mock.calls.find(([, entity]) => entity === CustomerUser)
    expect(userCall?.[2]).toMatchObject({ id: userId, tenantId, organizationId: orgId, deletedAt: null })
    expect(userCall?.[4]).toEqual({ tenantId, organizationId: orgId })
  })

  it('returns 404 and revokes nothing when the user is outside the admin organization', async () => {
    mockGetAuth.mockResolvedValue({ sub: adminId, tenantId, orgId: '33333333-3333-4333-8333-333333333333' })

    const res = await callDelete()

    expect(res.status).toBe(404)
    expect(mockRevokeSession).not.toHaveBeenCalled()
  })

  it('returns 404 and revokes nothing when the session belongs to another user or is already revoked', async () => {
    const res = await callDelete(userId, otherSessionId)

    expect(res.status).toBe(404)
    expect(mockRevokeSession).not.toHaveBeenCalled()
  })

  it('returns 403 without the customer_accounts.manage feature', async () => {
    mockUserHasAllFeatures.mockResolvedValue(false)

    const res = await callDelete()

    expect(res.status).toBe(403)
    expect(mockFindOneWithDecryption).not.toHaveBeenCalled()
    expect(mockRevokeSession).not.toHaveBeenCalled()
  })

  it('returns 401 when the request is not authenticated', async () => {
    mockGetAuth.mockResolvedValue(null)

    const res = await callDelete()

    expect(res.status).toBe(401)
    expect(mockRevokeSession).not.toHaveBeenCalled()
  })

  it('returns 400 for a non-UUID session id', async () => {
    const res = await callDelete(userId, 'not-a-uuid')

    expect(res.status).toBe(400)
    expect(mockGetAuth).not.toHaveBeenCalled()
    expect(mockRevokeSession).not.toHaveBeenCalled()
  })

  it('documents the DELETE method in OpenAPI', () => {
    expect(openApi.methods.DELETE).toBeDefined()
  })
})
