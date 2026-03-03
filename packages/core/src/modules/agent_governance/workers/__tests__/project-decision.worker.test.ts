import handle from '@open-mercato/core/modules/agent_governance/workers/project-decision.worker'

const mockEmitAgentGovernanceEvent = jest.fn()

jest.mock('@open-mercato/core/modules/agent_governance/events', () => ({
  emitAgentGovernanceEvent: (...args: unknown[]) => mockEmitAgentGovernanceEvent(...args),
}))

describe('project-decision.worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('projects decision and emits precedent indexed event', async () => {
    const projector = {
      projectDecisionEvent: jest.fn().mockResolvedValue({
        projected: true,
        skipped: false,
        checksum: 'checksum-1',
        entityLinks: 3,
        whyLinks: 2,
      }),
    }

    await handle(
      {
        payload: {
          eventId: 'event-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
        },
      } as any,
      {
        jobId: 'job-1',
        attemptNumber: 1,
        resolve: jest.fn((name: string) => {
          if (name === 'agentGovernanceDecisionProjectorService') {
            return projector
          }
          return null
        }),
      } as any,
    )

    expect(projector.projectDecisionEvent).toHaveBeenCalled()
    expect(mockEmitAgentGovernanceEvent).toHaveBeenCalledWith(
      'agent_governance.precedent.indexed',
      expect.objectContaining({ eventId: 'event-1', checksum: 'checksum-1' }),
    )
  })
})
