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

describe('agent_governance playbook scheduler integration', () => {
  const commandBus = new CommandBus()
  const schedulerService = {
    register: jest.fn(async () => undefined),
    unregister: jest.fn(async () => undefined),
  }
  const telemetryService = {
    recordDecisionWithDurability: jest.fn(async () => ({
      eventId: 'decision-1',
      immutableHash: 'hash-1',
      signature: 'sig-1',
      degraded: false,
      repairRequired: false,
    })),
  }

  let idCounter = 0
  const em = {
    fork: jest.fn(),
    create: jest.fn((_entity: unknown, payload: Record<string, unknown>) => {
      idCounter += 1
      return { id: `playbook-${idCounter}`, ...payload }
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }

  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'schedulerService') return schedulerService
      if (name === 'agentGovernanceTelemetryService') return telemetryService
      return null
    }),
  }

  const ctx = {
    container,
    auth: {
      sub: 'user-1',
      tenantId: '00000000-0000-4000-8000-000000000001',
      orgId: '10000000-0000-4000-8000-000000000001',
    },
    selectedOrganizationId: '10000000-0000-4000-8000-000000000001',
    organizationScope: null,
    organizationIds: ['10000000-0000-4000-8000-000000000001'],
  }

  beforeAll(async () => {
    if (!commandRegistry.has('agent_governance.playbooks.create')) {
      await import('../playbooks')
    }
  })

  beforeEach(() => {
    jest.clearAllMocks()
    idCounter = 0
    em.fork.mockReturnValue(em)
  })

  test('registers scheduler for active scheduled playbooks', async () => {
    const result = await commandBus.execute('agent_governance.playbooks.create', {
      input: {
        tenantId: '00000000-0000-4000-8000-000000000001',
        organizationId: '10000000-0000-4000-8000-000000000001',
        name: 'Daily governance check',
        triggerType: 'scheduled',
        scheduleCron: '0 7 * * *',
        isActive: true,
      },
      ctx,
    })

    expect(result.result.playbookId).toBe('playbook-1')
    expect(schedulerService.register).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'agent_governance:playbook:playbook-1',
        targetQueue: 'agent-governance-dispatch',
      }),
    )
  })

  test('unregisters scheduler when playbook is switched to manual trigger', async () => {
    mockFindOneWithDecryption.mockResolvedValueOnce({
      id: '9c541363-a501-48f2-a669-c481cc8ce0ac',
      tenantId: '00000000-0000-4000-8000-000000000001',
      organizationId: '10000000-0000-4000-8000-000000000001',
      name: 'Legacy schedule',
      description: null,
      policyId: null,
      riskBandId: null,
      triggerType: 'scheduled',
      scheduleCron: '0 * * * *',
      isActive: true,
      deletedAt: null,
      updatedAt: new Date(),
    })

    await commandBus.execute('agent_governance.playbooks.update', {
      input: {
        id: '9c541363-a501-48f2-a669-c481cc8ce0ac',
        triggerType: 'manual',
        scheduleCron: null,
      },
      ctx,
    })

    expect(schedulerService.unregister).toHaveBeenCalledWith('agent_governance:playbook:9c541363-a501-48f2-a669-c481cc8ce0ac')
  })
})
