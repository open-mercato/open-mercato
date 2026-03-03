import { GET } from '@open-mercato/core/modules/agent_governance/api/precedents/explain/route'

const mockFindOneWithDecryption = jest.fn()
const mockFindWithDecryption = jest.fn()
const mockCreateRequestContainer = jest.fn()
const mockGetAuthFromRequest = jest.fn()
const mockResolveOrganizationScopeForRequest = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
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

describe('GET /api/agent_governance/precedents/explain', () => {
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

  it('returns 404 when event is out of scope or missing', async () => {
    mockFindOneWithDecryption.mockResolvedValue(null)

    const response = await GET(
      new Request('http://localhost/api/agent_governance/precedents/explain?eventId=4d3df8df-91d6-40dd-a4df-f7fc6654621a'),
    )

    expect(response.status).toBe(404)
    expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
      em,
      expect.any(Function),
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      }),
      undefined,
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })

  it('returns event explanation with why links in scope', async () => {
    mockFindOneWithDecryption.mockResolvedValue({
      id: '4d3df8df-91d6-40dd-a4df-f7fc6654621a',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      controlPath: 'auto',
      status: 'success',
      riskScore: 20,
      policyId: null,
      riskBandId: null,
      signature: 'sig-1',
      createdAt: new Date('2026-03-03T10:00:00.000Z'),
    })
    mockFindWithDecryption.mockResolvedValue([
      {
        id: 'why-1',
        reasonType: 'policy',
        summary: 'Policy applied',
        refId: 'policy-1',
        confidence: 0.9,
        createdAt: new Date('2026-03-03T10:00:00.000Z'),
      },
    ])

    const response = await GET(
      new Request('http://localhost/api/agent_governance/precedents/explain?eventId=4d3df8df-91d6-40dd-a4df-f7fc6654621a'),
    )

    expect(response.status).toBe(200)
    const payload = await response.json()
    expect(payload.whyLinks).toHaveLength(1)
    expect(mockFindWithDecryption).toHaveBeenCalledWith(
      em,
      expect.any(Function),
      expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1' }),
      expect.any(Object),
      { tenantId: 'tenant-1', organizationId: 'org-1' },
    )
  })
})
