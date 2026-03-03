import { GET } from '@open-mercato/core/modules/agent_governance/api/context-graph/neighbors/route'

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

describe('GET /api/agent_governance/context-graph/neighbors', () => {
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
  })

  it('returns empty neighbors when anchor has no scoped links', async () => {
    mockFindWithDecryption.mockResolvedValueOnce([])

    const response = await GET(
      new Request('http://localhost/api/agent_governance/context-graph/neighbors?eventId=4d3df8df-91d6-40dd-a4df-f7fc6654621a&limit=5'),
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.neighbors).toEqual([])
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      expect.any(Function),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      expect.any(Object),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('filters neighbors by same scoped entity pairs', async () => {
    mockFindWithDecryption
      .mockResolvedValueOnce([
        {
          entityType: 'agent_governance_policy',
          entityId: 'policy-1',
          decisionEvent: { id: 'event-anchor' },
          relationshipType: 'target',
          createdAt: new Date('2026-03-03T10:00:00.000Z'),
        },
      ])
      .mockResolvedValueOnce([
        {
          entityType: 'agent_governance_policy',
          entityId: 'policy-1',
          decisionEvent: { id: 'event-neighbor' },
          relationshipType: 'target',
          createdAt: new Date('2026-03-03T11:00:00.000Z'),
        },
      ])

    const response = await GET(
      new Request('http://localhost/api/agent_governance/context-graph/neighbors?eventId=4d3df8df-91d6-40dd-a4df-f7fc6654621a&limit=5'),
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.neighbors).toEqual([
      expect.objectContaining({
        eventId: 'event-neighbor',
        entityType: 'agent_governance_policy',
        entityId: 'policy-1',
      }),
    ])
  })
})
