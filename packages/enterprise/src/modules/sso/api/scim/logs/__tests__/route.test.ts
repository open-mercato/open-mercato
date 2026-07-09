/** @jest-environment node */

const tenantId = '11111111-1111-4111-8111-111111111111'
const organizationId = '22222222-2222-4222-8222-222222222222'
const ssoConfigId = '33333333-3333-4333-8333-333333333333'

const mockFindWithDecryption = jest.fn()
const mockResolveSsoAdminContext = jest.fn()
const mockEm = {
  find: jest.fn(),
}

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: async () => ({
    resolve: (token: string) => {
      if (token === 'em') return mockEm
      throw new Error(`Unexpected token: ${token}`)
    },
  }),
}))

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('../../../admin-context', () => ({
  resolveSsoAdminContext: (...args: unknown[]) => mockResolveSsoAdminContext(...args),
  SsoAdminAuthError: class SsoAdminAuthError extends Error {
    constructor(
      message: string,
      public readonly statusCode: number,
    ) {
      super(message)
      this.name = 'SsoAdminAuthError'
    }
  },
}))

describe('SCIM logs route', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockEm.find.mockResolvedValue([])
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('rejects non-superadmins without organization context before querying logs', async () => {
    mockResolveSsoAdminContext.mockResolvedValue({
      auth: { sub: 'user-1', tenantId, orgId: null },
      scope: { isSuperAdmin: false, tenantId, organizationId: null },
    })

    const { GET } = await import('../route')
    const response = await GET(new Request(`http://localhost/api/sso/scim/logs?ssoConfigId=${ssoConfigId}`))

    await expect(response.json()).resolves.toEqual({ error: 'Organization context is required' })
    expect(response.status).toBe(403)
    expect(mockFindWithDecryption).not.toHaveBeenCalled()
    expect(mockEm.find).not.toHaveBeenCalled()
  })

  it('scopes non-superadmin log reads to the caller organization', async () => {
    mockResolveSsoAdminContext.mockResolvedValue({
      auth: { sub: 'user-1', tenantId, orgId: organizationId },
      scope: { isSuperAdmin: false, tenantId, organizationId },
    })
    const createdAt = new Date('2026-07-07T12:00:00.000Z')
    mockFindWithDecryption.mockResolvedValue([
      {
        id: '44444444-4444-4444-8444-444444444444',
        operation: 'create',
        resourceType: 'User',
        resourceId: null,
        scimExternalId: 'external-1',
        responseStatus: 201,
        errorMessage: null,
        createdAt,
      },
    ])

    const { GET } = await import('../route')
    const response = await GET(new Request(`http://localhost/api/sso/scim/logs?ssoConfigId=${ssoConfigId}`))

    await expect(response.json()).resolves.toEqual({
      items: [{
        id: '44444444-4444-4444-8444-444444444444',
        operation: 'create',
        resourceType: 'User',
        resourceId: null,
        scimExternalId: 'external-1',
        responseStatus: 201,
        errorMessage: null,
        createdAt: createdAt.toISOString(),
      }],
    })
    expect(response.status).toBe(200)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      mockEm,
      expect.any(Function),
      { ssoConfigId, organizationId },
      { orderBy: { createdAt: 'desc' }, limit: 50 },
      { tenantId, organizationId },
    )
    expect(mockEm.find).not.toHaveBeenCalled()
  })
})
