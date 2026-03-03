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

describe('agent_governance runs concurrency guard', () => {
  const commandBus = new CommandBus()

  const em = {
    fork: jest.fn(),
  }

  const runOrchestrator = {
    transitionRun: jest.fn(),
    rerouteRun: jest.fn(),
  }

  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'agentGovernanceRunOrchestratorService') return runOrchestrator
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
    if (!commandRegistry.has('agent_governance.runs.pause')) {
      await import('../runs')
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
  })

  test('blocks pause when expectedStatus does not match live run status', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: 'f15fe7aa-cf9f-4bc6-8f29-85bd8f3f50b7',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'running',
      actionType: 'policy.update',
      targetEntity: 'agent_governance_policy',
      targetId: 'policy-1',
    })

    await expect(
      commandBus.execute('agent_governance.runs.pause', {
        input: {
          id: 'f15fe7aa-cf9f-4bc6-8f29-85bd8f3f50b7',
          reason: 'operator pause',
          expectedStatus: 'checkpoint',
        },
        ctx,
      }),
    ).rejects.toMatchObject({ status: 409 })

    expect(runOrchestrator.transitionRun).not.toHaveBeenCalled()
  })

  test('blocks reroute when expectedStatus does not match live run status', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: '9379e491-566e-4b06-beb7-f4d8ba8fa3b4',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      status: 'running',
      actionType: 'playbook.execute',
      targetEntity: 'agent_governance_playbook',
      targetId: 'playbook-1',
    })

    await expect(
      commandBus.execute('agent_governance.runs.reroute', {
        input: {
          id: '9379e491-566e-4b06-beb7-f4d8ba8fa3b4',
          riskBandId: '6b8e8f44-758f-4722-ba11-c55576154db9',
          expectedStatus: 'paused',
        },
        ctx,
      }),
    ).rejects.toMatchObject({ status: 409 })

    expect(runOrchestrator.rerouteRun).not.toHaveBeenCalled()
  })
})
