/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PUT, DELETE } from '../[id]'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const USER_ID = '123e4567-e89b-12d3-a456-426614174070'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const mockGetAuthFromRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()

const mockEm = {
  nativeUpdate: jest.fn(async () => undefined),
  nativeDelete: jest.fn(async () => undefined),
  create: jest.fn(() => ({})),
  persist: jest.fn().mockReturnThis(),
  flush: jest.fn(async () => undefined),
}

const mockRbacService = { userHasAllFeatures: jest.fn(async () => true) }
const mockCustomerRbacService = { invalidateUserCache: jest.fn(async () => undefined) }
const mockCustomerUserService = { softDelete: jest.fn(async () => undefined) }
const mockCustomerSessionService = { revokeAllUserSessions: jest.fn(async () => undefined) }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    if (token === 'customerRbacService') return mockCustomerRbacService
    if (token === 'customerUserService') return mockCustomerUserService
    if (token === 'customerSessionService') return mockCustomerSessionService
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn((...args: unknown[]) => mockFindOneWithDecryption(...args)),
  findWithDecryption: jest.fn((...args: unknown[]) => mockFindWithDecryption(...args)),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn(async () => undefined),
}))

function request(method: string, headerVersion: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request(`http://localhost/api/customer_accounts/admin/users/${USER_ID}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const params = { params: { id: USER_ID } }

describe('customer_accounts admin user optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: 'org-1' })
    mockFindOneWithDecryption.mockResolvedValue({ id: USER_ID, email: 'a@b.com', updatedAt: new Date(CURRENT_VERSION) })
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('PUT returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await PUT(request('PUT', STALE_VERSION, { displayName: 'X' }), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
  })

  it('PUT succeeds and bumps updated_at when the expected version matches', async () => {
    const res = await PUT(request('PUT', CURRENT_VERSION, { displayName: 'X' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.updatedAt).toBe('string')
    expect(mockEm.nativeUpdate).toHaveBeenCalled()
    const updates = mockEm.nativeUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(updates.updatedAt).toBeInstanceOf(Date)
  })

  it('PUT is a no-op (no 409) when the client sends no expected-version header (strictly additive)', async () => {
    const res = await PUT(request('PUT', null, { displayName: 'X' }), params)
    expect(res.status).toBe(200)
    expect(mockEm.nativeUpdate).toHaveBeenCalled()
  })

  it('DELETE returns 409 when the expected version is stale', async () => {
    const res = await DELETE(request('DELETE', STALE_VERSION), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
  })
})
