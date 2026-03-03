import handle from '@open-mercato/core/modules/agent_governance/workers/telemetry-repair.worker'

const mockFindOneWithDecryption = jest.fn()
const mockEmitAgentGovernanceEvent = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/agent_governance/events', () => ({
  emitAgentGovernanceEvent: (...args: unknown[]) => mockEmitAgentGovernanceEvent(...args),
}))

describe('telemetry-repair.worker', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('pauses running run and emits anomaly event', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { runId: 'run-1' } })

    mockFindOneWithDecryption.mockResolvedValue({
      id: 'run-1',
      status: 'running',
    })

    await handle(
      {
        payload: {
          runId: 'run-1',
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          targetEntity: 'agent_governance_policy',
          targetId: 'policy-1',
        },
      } as any,
      {
        jobId: 'job-1',
        attemptNumber: 1,
        resolve: jest.fn((name: string) => {
          if (name === 'em') return {}
          if (name === 'commandBus') return { execute }
          return null
        }),
      } as any,
    )

    expect(execute).toHaveBeenCalledWith(
      'agent_governance.runs.pause',
      expect.objectContaining({ input: expect.objectContaining({ id: 'run-1' }) }),
    )

    expect(mockEmitAgentGovernanceEvent).toHaveBeenCalledWith(
      'agent_governance.anomaly.detected',
      expect.objectContaining({ type: 'telemetry_repair_required', runId: 'run-1' }),
    )
  })

  it('stays idempotent across worker restarts by not re-pausing already paused runs', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { runId: 'run-2' } })

    mockFindOneWithDecryption
      .mockResolvedValueOnce({
        id: 'run-2',
        status: 'running',
      })
      .mockResolvedValueOnce({
        id: 'run-2',
        status: 'paused',
      })

    const workerContext = {
      jobId: 'job-restart',
      attemptNumber: 1,
      resolve: jest.fn((name: string) => {
        if (name === 'em') return {}
        if (name === 'commandBus') return { execute }
        return null
      }),
    } as any

    const job = {
      payload: {
        runId: 'run-2',
        tenantId: 'tenant-1',
        organizationId: 'org-1',
      },
    } as any

    await handle(job, workerContext)
    await handle(job, workerContext)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(mockEmitAgentGovernanceEvent).toHaveBeenCalledTimes(2)
  })
})
