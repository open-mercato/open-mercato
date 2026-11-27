/** @jest-environment node */

import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { CustomerUser } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerEntity } from '@open-mercato/core/modules/customers/data/entities'
import { PUT, DELETE } from '../[id]'

const TENANT_ID = '123e4567-e89b-12d3-a456-426614174001'
const USER_ID = '123e4567-e89b-12d3-a456-426614174070'
const CURRENT_VERSION = '2026-06-01T10:00:00.000Z'
const STALE_VERSION = '2026-06-01T09:00:00.000Z'
const COMPANY_ID = '11111111-1111-4111-8111-111111111111'
const PERSON_ID = '22222222-2222-4222-8222-222222222222'
const NEW_LINK_ID = '33333333-3333-4333-8333-333333333333'

const mockGetAuthFromRequest = jest.fn()
const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockFindMetadata = jest.fn()

const mockEm = {
  getMetadata: () => ({ find: mockFindMetadata }),
  nativeUpdate: jest.fn(async (_entity: unknown, _where: unknown, _updates: Record<string, unknown>) => undefined),
  nativeDelete: jest.fn(async () => undefined),
  create: jest.fn(() => ({})),
  persist: jest.fn().mockReturnThis(),
  flush: jest.fn(async () => undefined),
}

const mockRbacService = { userHasAllFeatures: jest.fn(async () => true) }
const mockCustomerRbacService = { invalidateUserCache: jest.fn(async () => undefined) }
const mockCustomerUserService = {
  softDelete: jest.fn(async () => undefined),
  updateProfile: jest.fn(async () => undefined),
}
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

  it('PUT never writes the encrypted display_name through nativeUpdate (#3837)', async () => {
    const res = await PUT(request('PUT', CURRENT_VERSION, { displayName: 'X' }), params)
    expect(res.status).toBe(200)
    // `nativeUpdate` skips the flush hooks the tenant-encryption subscriber depends on, so
    // display_name must travel through the service, which writes it via the managed entity.
    const updates = mockEm.nativeUpdate.mock.calls[0][2] as Record<string, unknown>
    expect(updates.displayName).toBeUndefined()
    expect(mockCustomerUserService.updateProfile).toHaveBeenCalledWith(
      expect.objectContaining({ id: USER_ID }),
      { displayName: 'X' },
    )
  })

  it('PUT leaves the profile service alone when no display name is submitted', async () => {
    const res = await PUT(request('PUT', CURRENT_VERSION, { isActive: false }), params)
    expect(res.status).toBe(200)
    expect(mockCustomerUserService.updateProfile).not.toHaveBeenCalled()
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

describe('customer_accounts admin user CRM links', () => {
  const storedLinks = { customerEntityId: COMPANY_ID, personEntityId: PERSON_ID }
  const user = {
    id: USER_ID,
    email: 'buyer@example.test',
    tenantId: TENANT_ID,
    organizationId: 'org-1',
    updatedAt: new Date(CURRENT_VERSION),
    ...storedLinks,
  }

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_OPTIMISTIC_LOCK
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: TENANT_ID, orgId: user.organizationId })
    mockFindOneWithDecryption.mockImplementation(async (_em: unknown, entity: unknown) => entity === CustomerUser ? user : null)
    mockFindMetadata.mockReturnValue(undefined)
  })

  it('saves a display name while retaining both stored CRM links when customers is disabled', async () => {
    const res = await PUT(request('PUT', CURRENT_VERSION, { ...storedLinks, displayName: 'Buyer' }), params)

    expect(res.status).toBe(200)
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockCustomerUserService.updateProfile).toHaveBeenCalledWith(user, { displayName: 'Buyer' })
    expect(mockEm.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: USER_ID, tenantId: TENANT_ID, organizationId: user.organizationId },
      { updatedAt: expect.any(Date) },
    )
  })

  it.each([
    ['customerEntityId', 'Company not found'],
    ['personEntityId', 'Person not found'],
  ] as const)('rejects a changed %s when customers is disabled', async (field, error) => {
    const res = await PUT(request('PUT', CURRENT_VERSION, { ...storedLinks, [field]: NEW_LINK_ID }), params)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error })
    expect(mockFindOneWithDecryption).toHaveBeenCalledTimes(1)
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
  })

  it('allows explicit unlinking when customers is disabled', async () => {
    const unlinked = { customerEntityId: null, personEntityId: null }
    const res = await PUT(request('PUT', CURRENT_VERSION, unlinked), params)

    expect(res.status).toBe(200)
    expect(mockEm.nativeUpdate).toHaveBeenCalledWith(
      CustomerUser,
      { id: USER_ID, tenantId: TENANT_ID, organizationId: user.organizationId },
      { ...unlinked, updatedAt: expect.any(Date) },
    )
  })

  it.each([
    ['customerEntityId', 'company', 'Company not found'],
    ['personEntityId', 'person', 'Person not found'],
  ] as const)('validates a resubmitted %s within the caller scope when customers is enabled', async (field, kind, error) => {
    mockFindMetadata.mockImplementation((entity: unknown) => entity === CustomerEntity ? { class: entity } : undefined)

    const res = await PUT(request('PUT', CURRENT_VERSION, { [field]: storedLinks[field] }), params)

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({ ok: false, error })
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      mockEm,
      CustomerEntity,
      {
        id: storedLinks[field],
        tenantId: TENANT_ID,
        organizationId: user.organizationId,
        kind,
        deletedAt: null,
      },
      undefined,
      { tenantId: TENANT_ID, organizationId: user.organizationId },
    )
    expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
  })
})
