import { beforeAll, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { CommandBus } from '@open-mercato/shared/lib/commands'
import { commandRegistry } from '@open-mercato/shared/lib/commands/registry'

const mockFindOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => mockFindOneWithDecryption(...args),
}))

const mockEmitEvent = jest.fn()
jest.mock('@open-mercato/core/modules/agent_governance/events', () => ({
  emitAgentGovernanceEvent: (...args: unknown[]) => mockEmitEvent(...args),
}))

describe('agent_governance approvals security', () => {
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

  beforeAll(async () => {
    if (!commandRegistry.has('agent_governance.approvals.approve')) {
      await import('../approvals')
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    em.fork.mockReturnValue(em)
  })

  test('rejects approval spoofing attempts across tenant scope', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: 'a7e4f94f-f9be-4bf9-b95b-0904b3c1a43a',
      tenantId: 'tenant-other',
      organizationId: 'org-other',
      status: 'pending',
      run: {
        id: 'run-1',
        tenantId: 'tenant-other',
        organizationId: 'org-other',
      },
    })

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

    await expect(
      commandBus.execute('agent_governance.approvals.approve', {
        input: {
          id: 'a7e4f94f-f9be-4bf9-b95b-0904b3c1a43a',
          comment: null,
        },
        ctx,
      }),
    ).rejects.toMatchObject({ status: 403 })

    expect(runOrchestrator.transitionRun).not.toHaveBeenCalled()
    expect(telemetryService.recordDecision).not.toHaveBeenCalled()
  })
})
