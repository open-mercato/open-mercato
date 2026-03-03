import { POST } from '@open-mercato/core/modules/agent_governance/api/skills/capture/route'

const mockBuildCommandRouteContext = jest.fn()
const mockParseScopedCommandInput = jest.fn()

jest.mock('@open-mercato/core/modules/agent_governance/api/route-helpers', () => ({
  buildCommandRouteContext: (...args: unknown[]) => mockBuildCommandRouteContext(...args),
}))

jest.mock('@open-mercato/shared/lib/api/scoped', () => ({
  parseScopedCommandInput: (...args: unknown[]) => mockParseScopedCommandInput(...args),
}))

describe('POST /api/agent_governance/skills/capture', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('executes capture command with scoped input', async () => {
    const commandBus = {
      execute: jest.fn().mockResolvedValue({
        result: {
          skillId: 'ddb1617a-3532-4bb3-b64e-bdd70b69984b',
          status: 'draft',
          validationReport: null,
          skillVersionId: null,
          versionNo: null,
        },
      }),
    }

    mockBuildCommandRouteContext.mockResolvedValue({
      ctx: { selectedOrganizationId: 'org-1', auth: { tenantId: 'tenant-1' } },
      translate: (key: string, fallback: string) => fallback,
      commandBus,
    })

    mockParseScopedCommandInput.mockReturnValue({
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      actionType: 'quote.approve',
      targetEntity: 'sales_quote',
    })

    const response = await POST(new Request('http://localhost/api/agent_governance/skills/capture', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ actionType: 'quote.approve', targetEntity: 'sales_quote' }),
    }))

    expect(response.status).toBe(200)
    expect(commandBus.execute).toHaveBeenCalledWith(
      'agent_governance.skills.capture_from_trace',
      expect.objectContaining({
        input: expect.objectContaining({ actionType: 'quote.approve', targetEntity: 'sales_quote' }),
      }),
    )
  })
})
