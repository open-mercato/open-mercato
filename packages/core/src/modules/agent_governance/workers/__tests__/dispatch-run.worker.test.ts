import handle from '@open-mercato/core/modules/agent_governance/workers/dispatch-run.worker'

describe('dispatch-run.worker', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('dispatches a governed run start command', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { runId: 'run-1' } })

    await handle(
      {
        payload: {
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          playbookId: 'playbook-1',
          actionType: 'playbook.execute',
          targetEntity: 'agent_governance_playbook',
          targetId: 'playbook-1',
          _idempotencyKey: 'scheduler-key-1',
        },
      } as any,
      {
        jobId: 'job-1',
        attemptNumber: 1,
        resolve: jest.fn((name: string) => {
          if (name === 'commandBus') {
            return { execute }
          }
          return null
        }),
      } as any,
    )

    expect(execute).toHaveBeenCalledWith(
      'agent_governance.runs.start',
      expect.objectContaining({
        input: expect.objectContaining({
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          idempotencyKey: 'scheduler-key-1',
        }),
      }),
    )
  })

  it('keeps idempotency stable for duplicate deliveries when key is provided', async () => {
    const execute = jest.fn().mockResolvedValue({ result: { runId: 'run-1' } })
    const ctx = {
      jobId: 'job-dup',
      attemptNumber: 2,
      resolve: jest.fn((name: string) => {
        if (name === 'commandBus') return { execute }
        return null
      }),
    } as any

    const payload = {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      playbookId: 'playbook-1',
      _idempotencyKey: 'dispatch-fixed-key',
    }

    await handle({ payload } as any, ctx)
    await handle({ payload } as any, ctx)

    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenNthCalledWith(
      1,
      'agent_governance.runs.start',
      expect.objectContaining({ input: expect.objectContaining({ idempotencyKey: 'dispatch-fixed-key' }) }),
    )
    expect(execute).toHaveBeenNthCalledWith(
      2,
      'agent_governance.runs.start',
      expect.objectContaining({ input: expect.objectContaining({ idempotencyKey: 'dispatch-fixed-key' }) }),
    )
  })

  it('generates deterministic minute-bucket idempotency key when none is provided', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-03T10:11:12.999Z'))

    const execute = jest.fn().mockResolvedValue({ result: { runId: 'run-1' } })

    await handle(
      {
        payload: {
          tenantId: 'tenant-1',
          organizationId: 'org-1',
          playbookId: 'playbook-77',
          actionType: 'playbook.execute',
        },
      } as any,
      {
        jobId: 'job-time-bucket',
        attemptNumber: 1,
        resolve: jest.fn((name: string) => {
          if (name === 'commandBus') return { execute }
          return null
        }),
      } as any,
    )

    expect(execute).toHaveBeenCalledWith(
      'agent_governance.runs.start',
      expect.objectContaining({
        input: expect.objectContaining({
          idempotencyKey: 'dispatch:playbook-77:playbook.execute:2026-03-03T10:11',
        }),
      }),
    )
  })
})
