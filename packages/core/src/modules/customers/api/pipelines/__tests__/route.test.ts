/** @jest-environment node */

const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()
const mockFind = jest.fn()

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) =>
    mockResolveOrganizationScopeForRequest(...args),
}))

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback: string) => fallback,
  })),
}))

describe('customers pipelines route (GET org scoping)', () => {
  beforeEach(() => {
    mockCreateRequestContainer.mockReset()
    mockGetAuthFromRequest.mockReset()
    mockResolveOrganizationScopeForRequest.mockReset()
    mockFind.mockReset()
    mockCreateRequestContainer.mockResolvedValue({
      resolve: (token: string) => {
        if (token === 'em') return { find: mockFind }
        return null
      },
    })
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: 'tenant-1', orgId: null })
  })

  it('returns tenant-wide pipelines under the "All organizations" scope (no organizationId filter)', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: 'tenant-1',
    })
    mockFind.mockResolvedValue([])

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/customers/pipelines'))

    expect(response.status).toBe(200)
    const [, where] = mockFind.mock.calls[0]
    expect(where).toEqual({ tenantId: 'tenant-1' })
    expect(where).not.toHaveProperty('organizationId')
  })

  it('scopes to the selected organization when one is active', async () => {
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: 'org-1',
      filterIds: ['org-1'],
      allowedIds: null,
      tenantId: 'tenant-1',
    })
    mockFind.mockResolvedValue([])

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/customers/pipelines'))

    expect(response.status).toBe(200)
    const [, where] = mockFind.mock.calls[0]
    expect(where).toEqual({ tenantId: 'tenant-1', organizationId: { $in: ['org-1'] } })
  })

  it('still returns 400 when tenant context is missing', async () => {
    mockGetAuthFromRequest.mockResolvedValue({ sub: 'user-1', tenantId: null, orgId: null })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({
      selectedId: null,
      filterIds: null,
      allowedIds: null,
      tenantId: null,
    })

    const { GET } = await import('../route')
    const response = await GET(new Request('http://localhost/api/customers/pipelines'))

    expect(response.status).toBe(400)
    expect(mockFind).not.toHaveBeenCalled()
  })
})
