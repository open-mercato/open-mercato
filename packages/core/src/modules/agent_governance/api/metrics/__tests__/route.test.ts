import { GET } from '@open-mercato/core/modules/agent_governance/api/metrics/route'

const mockBuildCommandRouteContext = jest.fn()

jest.mock('@open-mercato/core/modules/agent_governance/api/route-helpers', () => ({
  buildCommandRouteContext: (...args: unknown[]) => mockBuildCommandRouteContext(...args),
}))

describe('GET /api/agent_governance/metrics', () => {
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

    const response = await GET(new Request('http://localhost/api/agent_governance/metrics'))

    expect(response.status).toBe(400)
  })

  it('returns metrics for tenant and organization scope', async () => {
    const getMetrics = jest.fn().mockResolvedValue({
      governance: {
        runsTotal: 1,
        runsByStatus: {
          queued: 0,
          running: 0,
          checkpoint: 0,
          paused: 0,
          failed: 0,
          completed: 1,
          terminated: 0,
        },
        pendingApprovals: 0,
        checkpointRate: 0,
        interventionLatencyMs: 0,
      },
      memory: {
        decisionsTotal: 1,
        traceCompletenessRate: 1,
        precedentWhyLinks: 1,
        precedentUsefulnessRate: 1,
      },
      operations: {
        failedRuns24h: 0,
        telemetryRepairSignals24h: 0,
        checkpointVolume24h: 0,
      },
      learning: {
        skillsTotal: 1,
        skillsByStatus: {
          draft: 1,
          validated: 0,
          active: 0,
          deprecated: 0,
        },
        promotedSkills30d: 0,
      },
    })

    const container = {
      resolve: jest.fn((name: string) => {
        if (name === 'agentGovernanceObservabilityService') {
          return { getMetrics }
        }
        return null
      }),
    }

    mockBuildCommandRouteContext.mockResolvedValue({
      ctx: {
        auth: { tenantId: 'tenant-1', orgId: 'org-auth' },
        selectedOrganizationId: 'org-1',
        container,
      },
    })

    const response = await GET(new Request('http://localhost/api/agent_governance/metrics'))

    expect(response.status).toBe(200)
    expect(getMetrics).toHaveBeenCalledWith({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })
})
