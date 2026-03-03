import { GET } from '@open-mercato/core/modules/agent_governance/api/precedents/search/route'

const mockFindWithDecryption = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => mockFindWithDecryption(...args),
}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: (...args: unknown[]) => mockCreateRequestContainer(...args),
}))

jest.mock('@open-mercato/shared/lib/auth/server', () => ({
  getAuthFromRequest: (...args: unknown[]) => mockGetAuthFromRequest(...args),
}))

jest.mock('@open-mercato/core/modules/directory/utils/organizationScope', () => ({
  resolveOrganizationScopeForRequest: (...args: unknown[]) => mockResolveOrganizationScopeForRequest(...args),
}))

describe('GET /api/agent_governance/precedents/search', () => {
  const em = {}
  const container = {
    resolve: jest.fn((name: string) => (name === 'em' ? em : null)),
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockCreateRequestContainer.mockResolvedValue(container)
    mockGetAuthFromRequest.mockResolvedValue({
      tenantId: 'tenant-1',
      orgId: 'org-auth',
      sub: 'user-1',
    })
    mockResolveOrganizationScopeForRequest.mockResolvedValue({ selectedId: 'org-1' })
    mockFindWithDecryption.mockResolvedValue([])
  })

  it('returns 401 when unauthenticated', async () => {
    mockGetAuthFromRequest.mockResolvedValue(null)

    const response = await GET(
      new Request('http://localhost/api/agent_governance/precedents/search?query=test'),
    )

    expect(response.status).toBe(401)
  })

  it('applies tenant and organization scope to search query', async () => {
    const response = await GET(
      new Request('http://localhost/api/agent_governance/precedents/search?query=policy+update&limit=10'),
    )

    expect(response.status).toBe(200)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      expect.any(Function),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
      expect.any(Object),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('uses exact signature lookup when signature is provided', async () => {
    await GET(
      new Request('http://localhost/api/agent_governance/precedents/search?query=ignored&signature=sig-1'),
    )

    const where = mockFindWithDecryption.mock.calls[0]?.[2]
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      signature: 'sig-1',
    })
    expect(where.summary).toBeUndefined()
  })
})
