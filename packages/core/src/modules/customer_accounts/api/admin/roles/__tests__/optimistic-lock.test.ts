/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { PUT, DELETE } from '../[id]'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ROLE_ID = '123e4567-e89b-12d3-a456-426614174080'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'

const mockGetAuthFromRequest = jest.fn()

const mockEm = {
  findOne: jest.fn(),
  count: jest.fn(async () => 0),
  nativeUpdate: jest.fn(async () => undefined),
}

const mockRbacService = { userHasAllFeatures: jest.fn(async () => true) }

const mockContainer = {
  resolve: jest.fn((token: string) => {
    if (token === 'em') return mockEm
    if (token === 'rbacService') return mockRbacService
    return null
  }),
}

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: jest.fn((req: Request) => mockGetAuthFromRequest(req)),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => mockContainer),
}))

jest.mock('@open-mercato/core/modules/customer_accounts/events', () => ({
  emitCustomerAccountsEvent: jest.fn(async () => undefined),
}))

function request(method: string, headerVersion: string | null, body?: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (headerVersion) headers[OPTIMISTIC_LOCK_HEADER_NAME] = headerVersion
  return new Request(`http://localhost/api/customer_accounts/admin/roles/${ROLE_ID}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

const params = { params: { id: ROLE_ID } }

describe('customer_accounts admin role optimistic locking', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: 'org-1' })
    mockEm.findOne.mockResolvedValue({
      id: ROLE_ID,
      name: 'Reviewer',
      slug: 'reviewer',
      isSystem: false,
      updatedAt: new Date(CURRENT_VERSION),
    })
  })

  it('PUT returns 409 with the structured conflict body when the expected version is stale', async () => {
    const res = await PUT(request('PUT', STALE_VERSION, { name: 'Renamed' }), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(body.currentUpdatedAt).toBe(CURRENT_VERSION)
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
  })

  it('PUT succeeds and bumps updated_at when the expected version matches', async () => {
    const res = await PUT(request('PUT', CURRENT_VERSION, { name: 'Renamed' }), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(typeof body.updatedAt).toBe('string')
    const updates = mockEm.nativeUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(updates.updatedAt).toBeInstanceOf(Date)
  })

  it('PUT is a no-op (no 409) when the client sends no expected-version header', async () => {
    const res = await PUT(request('PUT', null, { name: 'Renamed' }), params)
    expect(res.status).toBe(200)
  })

  it('DELETE returns 409 when the expected version is stale', async () => {
    const res = await DELETE(request('DELETE', STALE_VERSION), params)
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.code).toBe('optimistic_lock_conflict')
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
  })
})
