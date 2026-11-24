jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../lib/sdk/defineAgent', () => ({
  getAgentEntry: jest.fn(() => ({ id: 'deals.health_check' })),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { CustomerDeal } from '@open-mercato/core/modules/customers/data/entities'
import { AgentEvalAssertion, AgentEvalCase } from '../data/entities'
import { seedAgentOrchestratorExamples } from '../lib/seeds'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function buildHarness(disabled: unknown[]) {
  const em = {
    getMetadata: jest.fn(() => ({ find: (entity: unknown) => !disabled.includes(entity) })),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ __entity: entity, ...data })),
    persist: jest.fn(),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
  }
  em.fork.mockReturnValue(em)
  const commandBus = { execute: jest.fn().mockResolvedValue({}) }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'em') return em
      if (name === 'commandBus') return commandBus
      throw new Error(`[internal] unexpected resolve ${name}`)
    }),
  }
  return { em, commandBus, container: container as unknown as AwilixContainer }
}

function entitiesTouched(em: ReturnType<typeof buildHarness>['em']): unknown[] {
  return [
    ...em.findOne.mock.calls.map((call) => call[0]),
    ...em.create.mock.calls.map((call) => call[0]),
  ]
}

describe('seedAgentOrchestratorExamples with optional peers disabled (#9188)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.mocked(findOneWithDecryption).mockResolvedValue(null)
  })

  test('skips workflow and customers demo data but still seeds the eval assertions', async () => {
    const { em, commandBus, container } = buildHarness([WorkflowDefinition, CustomerDeal])

    await expect(
      seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope),
    ).resolves.toBeUndefined()

    const touched = entitiesTouched(em)
    expect(touched).not.toContain(WorkflowDefinition)
    expect(touched).not.toContain(CustomerDeal)
    expect(touched).not.toContain(AgentEvalCase)
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(em.create.mock.calls.filter((call) => call[0] === AgentEvalAssertion).length).toBeGreaterThan(0)
  })

  test('skips only the workflow seeds when workflows is disabled', async () => {
    const { em, commandBus, container } = buildHarness([WorkflowDefinition])

    await seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope)

    expect(entitiesTouched(em)).not.toContain(WorkflowDefinition)
    expect(commandBus.execute).toHaveBeenCalledWith('customers.deals.create', expect.anything())
  })

  test('seeds workflow definitions and demo deals when both peers are enabled', async () => {
    const { em, commandBus, container } = buildHarness([])

    await seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope)

    expect(em.create.mock.calls.filter((call) => call[0] === WorkflowDefinition)).toHaveLength(2)
    expect(commandBus.execute).toHaveBeenCalledTimes(2)
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      CustomerDeal,
      expect.anything(),
      undefined,
      scope,
    )
  })
})
