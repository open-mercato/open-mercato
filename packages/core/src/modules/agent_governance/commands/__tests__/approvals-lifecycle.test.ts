import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

const mockFindOneWithDecryption = jest.fn()
const mockEmitEvent = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

jest.mock('@open-mercato/core/modules/agent_governance/events', () => ({
  emitAgentGovernanceEvent: (...args: unknown[]) => mockEmitEvent(...args),
}))

describe('agent_governance approvals lifecycle', () => {
  const commandBus = new CommandBus()

  const em = {
    fork: jest.fn(),
    flush: jest.fn(async () => undefined),
  }

  const runOrchestrator = {
    transitionRun: jest.fn(),
  }

  const telemetryService = {
    recordDecision: jest.fn(),
  }

  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'agentGovernanceRunOrchestratorService') return runOrchestrator
      if (name === 'agentGovernanceTelemetryService') return telemetryService
      return null
    }),
  }

  const ctx = {
    container,
    auth: {
      sub: 'user-1',
      tenantId: 'tenant-1',
      orgId: 'org-1',
    },
    selectedOrganizationId: 'org-1',
    organizationScope: null,
    organizationIds: ['org-1'],
  }

  beforeAll(async () => {
    if (!commandRegistry.has('agent_governance.approvals.approve')) {
      await import('../approvals')
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
  })

  test('approve moves pending checkpoint run to running and records telemetry', async () => {
    const run = {
      id: 'run-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'checkpoint',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
      policyId: null,
      riskBandId: null,
    }

    const task = {
      id: 'task-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'pending',
      run,
      decisionEventId: null,
      resolutionIdempotencyKey: null,
      reviewerUserId: null,
      reviewComment: null,
      reviewedAt: null,
      updatedAt: new Date(),
    }

    mockFindOneWithDecryption.mockResolvedValueOnce(task)
    runOrchestrator.transitionRun.mockResolvedValueOnce({
      run: { ...run, status: 'running' },
      telemetryEventId: 'run-transition-event-1',
      telemetryRepairRequired: false,
    })
    telemetryService.recordDecision.mockResolvedValueOnce({
      eventId: 'approval-event-1',
    })

    const result = await commandBus.execute('agent_governance.approvals.approve', {
      input: { id: '6aaea570-f542-45ff-9024-08c0823fb95a' },
      ctx,
    })

    expect(result.result).toEqual({ approvalTaskId: 'task-1', runId: 'run-1' })
    expect(task.status).toBe('approved')
    expect(runOrchestrator.transitionRun).toHaveBeenCalledWith(
      run,
      'running',
      expect.objectContaining({ controlPath: 'checkpoint' }),
    )
    expect(telemetryService.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-1',
        controlPath: 'checkpoint',
      }),
    )
  })

  test('reject moves pending checkpoint run to terminated and marks telemetry blocked', async () => {
    const run = {
      id: 'run-2',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'checkpoint',
      actionType: 'policy.delete',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-2',
      policyId: null,
      riskBandId: null,
    }

    const task = {
      id: 'task-2',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'pending',
      run,
      decisionEventId: null,
      resolutionIdempotencyKey: null,
      reviewerUserId: null,
      reviewComment: null,
      reviewedAt: null,
      updatedAt: new Date(),
    }

    mockFindOneWithDecryption.mockResolvedValueOnce(task)
    runOrchestrator.transitionRun.mockResolvedValueOnce({
      run: { ...run, status: 'terminated' },
      telemetryEventId: 'run-transition-event-2',
      telemetryRepairRequired: false,
    })
    telemetryService.recordDecision.mockResolvedValueOnce({
      eventId: 'approval-event-2',
    })

    const result = await commandBus.execute('agent_governance.approvals.reject', {
      input: { id: '4ef29be2-ed50-4b88-a83f-3ba8b14ba67d', comment: 'Risk unacceptable' },
      ctx,
    })

    expect(result.result).toEqual({ approvalTaskId: 'task-2', runId: 'run-2' })
    expect(task.status).toBe('rejected')
    expect(runOrchestrator.transitionRun).toHaveBeenCalledWith(
      run,
      'terminated',
      expect.objectContaining({ controlPath: 'rejected' }),
    )
    expect(telemetryService.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: 'run-2',
        controlPath: 'rejected',
        status: 'blocked',
      }),
    )
  })
})
