import { POST } from '@open-mercato/core/modules/agent_governance/api/retrieval/benchmark/route'

const mockBuildCommandRouteContext = jest.fn()

jest.mock('@open-mercato/core/modules/agent_governance/api/route-helpers', () => ({
  buildCommandRouteContext: (...args: unknown[]) => mockBuildCommandRouteContext(...args),
}))

describe('POST /api/agent_governance/retrieval/benchmark', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('returns 400 when scope is missing', async () => {
    mockBuildCommandRouteContext.mockResolvedValue({
      ctx: {
        auth: { tenantId: null, orgId: null },
        selectedOrganizationId: null,
        container: { resolve: jest.fn() },
      },
    })

    const response = await POST(
      new Request('http://localhost/api/agent_governance/retrieval/benchmark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cases: [{ actionType: 'policy.update', targetEntity: 'agent_governance_policy' }] }),
      }),
    )

    expect(response.status).toBe(400)
  })

  it('runs provider benchmark in current scope', async () => {
    const benchmarkProviders = jest.fn().mockResolvedValue({
      providers: [],
      recommendedProviderId: 'native',
      recommendationRationale: 'default',
    })

    mockBuildCommandRouteContext.mockResolvedValue({
      ctx: {
        auth: { tenantId: 'tenant-1', orgId: 'org-auth' },
        selectedOrganizationId: 'org-1',
        container: {
          resolve: jest.fn((name: string) => {
            if (name === 'agentGovernanceRetrievalBenchmarkService') {
              return { benchmarkProviders }
            }
            return null
          }),
        },
      },
    })

    const response = await POST(
      new Request('http://localhost/api/agent_governance/retrieval/benchmark', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          providers: ['native', 'lightrag'],
          cases: [{ actionType: 'policy.update', targetEntity: 'agent_governance_policy' }],
        }),
      }),
    )

    expect(response.status).toBe(200)
    expect(benchmarkProviders).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'tenant-1',
        organizationId: 'org-1',
        providers: ['native', 'lightrag'],
      }),
    )
  })
})
