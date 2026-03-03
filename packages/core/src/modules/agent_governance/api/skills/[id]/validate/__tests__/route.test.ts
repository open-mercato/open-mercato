import { POST } from '@open-mercato/core/modules/agent_governance/api/skills/[id]/validate/route'

const mockBuildCommandRouteContext = jest.fn()

jest.mock('@open-mercato/core/modules/agent_governance/api/route-helpers', () => ({
  buildCommandRouteContext: (...args: unknown[]) => mockBuildCommandRouteContext(...args),
}))

describe('POST /api/agent_governance/skills/:id/validate', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('executes validation command for selected skill', async () => {
    const commandBus = {
      execute: jest.fn().mockResolvedValue({
        result: {
          skillId: '3b775f26-4be6-4e2d-b318-8353af128f02',
          status: 'validated',
          passed: true,
          passRate: 0.8,
          skillVersionId: 'ca72f4eb-cde2-4806-800f-fabf5ba57c8b',
          versionNo: 1,
          validationReport: {},
        },
      }),
    }

    mockBuildCommandRouteContext.mockResolvedValue({
      ctx: { selectedOrganizationId: 'org-1', auth: { tenantId: 'tenant-1' } },
      commandBus,
    })

    const response = await POST(
      new Request('http://localhost/api/agent_governance/skills/3b775f26-4be6-4e2d-b318-8353af128f02/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ approvalDecision: 'approve', passRateThreshold: 0.6 }),
      }),
      {
        params: Promise.resolve({ id: '3b775f26-4be6-4e2d-b318-8353af128f02' }),
      },
    )

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'agent_governance.skills.validate',
      expect.objectContaining({
        input: expect.objectContaining({
          id: '3b775f26-4be6-4e2d-b318-8353af128f02',
          approvalDecision: 'approve',
        }),
      }),
    )
  })
})
