/** @jest-environment node */

import { DELETE } from '../[id]'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const ROLE_ID = '123e4567-e89b-12d3-a456-426614174080'

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

function deleteRequest() {
  return new Request(`http://localhost/api/customer_accounts/admin/roles/${ROLE_ID}`, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
  })
}

const params = { params: { id: ROLE_ID } }

describe('customer_accounts admin role deletion (#3556)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: 'org-1' })
    mockEm.count.mockResolvedValue(0)
  })

  it('soft-deletes a seeded system role once it has no dependents', async () => {
    mockEm.findOne.mockResolvedValue({
      id: ROLE_ID,
      name: 'Viewer',
      slug: 'viewer',
      isSystem: true,
      isDefault: false,
      updatedAt: null,
    })
    const res = await DELETE(deleteRequest(), params)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(mockEm.nativeUpdate).toHaveBeenCalledTimes(2)
  })

  it('blocks deleting the default role and guides the admin to reassign it first', async () => {
    mockEm.findOne.mockResolvedValue({
      id: ROLE_ID,
      name: 'Buyer',
      slug: 'buyer',
      isSystem: true,
      isDefault: true,
      updatedAt: null,
    })
    const res = await DELETE(deleteRequest(), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/default role/i)
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
  })

  it('blocks deleting a role that still has assigned users', async () => {
    mockEm.findOne.mockResolvedValue({
      id: ROLE_ID,
      name: 'Reviewer',
      slug: 'reviewer',
      isSystem: false,
      isDefault: false,
      updatedAt: null,
    })
    mockEm.count.mockResolvedValue(2)
    const res = await DELETE(deleteRequest(), params)
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/assigned user/i)
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
  })
})
