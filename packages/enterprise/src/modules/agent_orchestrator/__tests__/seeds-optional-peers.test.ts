jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
}))

jest.mock('../lib/sdk/defineAgent', () => ({
  getAgentEntry: jest.fn(() => ({ id: 'deals.health_check' })),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { asValue, createContainer } from 'awilix'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition } from '@open-mercato/core/modules/workflows/data/entities'
import { createWorkflowExampleAuthoring } from '@open-mercato/core/modules/workflows/lib/example-definition-authoring'
import { CustomerDeal } from '@open-mercato/core/modules/customers/data/entities'
import { AgentEvalAssertion, AgentEvalCase } from '../data/entities'
import { seedAgentOrchestratorExamples } from '../lib/seeds'

const scope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  organizationId: '22222222-2222-4222-8222-222222222222',
}
const exampleIds = [
  'agent_orchestrator_deals_health_check_v1',
  'agent_orchestrator_refund_triage_v1',
]

function buildHarness({ customers = true, workflows = true }: { customers?: boolean; workflows?: boolean } = {}) {
  const exampleRows = new Map<string, Record<string, unknown>>()
  const em = {
    getMetadata: jest.fn(() => ({ find: (entity: unknown) => entity !== CustomerDeal || customers })),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => ({ __entity: entity, ...data })),
    persist: jest.fn((data: Record<string, unknown>) => {
      if (data.__entity === WorkflowDefinition && typeof data.workflowId === 'string') {
        exampleRows.set(data.workflowId, data)
      }
    }),
    flush: jest.fn().mockResolvedValue(undefined),
    fork: jest.fn(),
    transactional: jest.fn(async (operation: (transaction: EntityManager) => Promise<void>) => {
      await operation(em as unknown as EntityManager)
      await em.flush()
    }),
  }
  em.fork.mockReturnValue(em)
  jest.mocked(findOneWithDecryption).mockImplementation(async (_em, entity, where) => {
    if (entity !== WorkflowDefinition) return null
    expect(where).toEqual({ ...scope, workflowId: expect.any(String) })
    const row = exampleRows.get((where as { workflowId: string }).workflowId)
    return row ? Object.assign(new WorkflowDefinition(), row) : null
  })
  const commandBus = { execute: jest.fn().mockResolvedValue({}) }
  const container = createContainer()
  container.register({
    em: asValue(em),
    commandBus: asValue(commandBus),
    organizationHierarchyService: asValue({ resolveAncestorIds: jest.fn().mockResolvedValue([]) }),
  })
  const realAuthoring = createWorkflowExampleAuthoring(container)
  const authoring = {
    createExampleDefinitionIfAbsent: jest.fn(realAuthoring.createExampleDefinitionIfAbsent),
  }
  if (workflows) container.register('workflowDefinitionAuthoring', asValue(authoring))
  return { em, commandBus, container, exampleRows, authoring }
}

function entitiesTouched(em: ReturnType<typeof buildHarness>['em']): unknown[] {
  return [
    ...em.findOne.mock.calls.map((call) => call[0]),
    ...em.create.mock.calls.map((call) => call[0]),
  ]
}

describe('seedAgentOrchestratorExamples with optional peers disabled (#9188)', () => {
  beforeEach(() => jest.clearAllMocks())

  test('skips workflow and customers demo data but still seeds the eval assertions', async () => {
    const { em, commandBus, container, authoring } = buildHarness({ customers: false, workflows: false })

    await expect(
      seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope),
    ).resolves.toBeUndefined()

    const touched = entitiesTouched(em)
    expect(touched).not.toContain(WorkflowDefinition)
    expect(touched).not.toContain(CustomerDeal)
    expect(touched).not.toContain(AgentEvalCase)
    expect(authoring.createExampleDefinitionIfAbsent).not.toHaveBeenCalled()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(em.create.mock.calls.filter((call) => call[0] === AgentEvalAssertion).length).toBeGreaterThan(0)
  })

  test('skips only the workflow seeds when workflows is disabled', async () => {
    const { em, commandBus, container } = buildHarness({ workflows: false })

    await seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope)

    expect(entitiesTouched(em)).not.toContain(WorkflowDefinition)
    expect(commandBus.execute).toHaveBeenCalledWith('customers.deals.create', expect.anything())
  })

  test('seeds both editable workflow definitions and demo deals when both peers are enabled', async () => {
    const { em, commandBus, container, exampleRows, authoring } = buildHarness()

    await seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope)

    expect([...exampleRows.keys()]).toEqual(exampleIds)
    expect(authoring.createExampleDefinitionIfAbsent).toHaveBeenCalledTimes(2)
    for (const row of exampleRows.values()) {
      expect(row).toMatchObject({ ...scope, version: 1, enabled: true, metadata: { category: 'Agents' } })
      expect(row.metadata).not.toHaveProperty('generatedBy')
      expect(row).not.toHaveProperty('grantedFeatures')
      expect(row).not.toHaveProperty('createdBy')
    }
    expect(commandBus.execute).toHaveBeenCalledTimes(2)
    expect(findOneWithDecryption).toHaveBeenCalledWith(
      em,
      CustomerDeal,
      expect.anything(),
      undefined,
      scope,
    )
  })

  test('keeps edited definitions when examples are seeded again', async () => {
    const { em, container, exampleRows } = buildHarness()
    const edited = { workflowName: 'Edited workflow', version: 2, enabled: false }
    exampleRows.set(exampleIds[0], edited)

    await seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope)

    expect(exampleRows.get(exampleIds[0])).toEqual({ workflowName: 'Edited workflow', version: 2, enabled: false })
    expect(em.transactional).toHaveBeenCalledTimes(1)
  })

  test('uses the owner fallback when a legacy override has no example operation', async () => {
    const { em, container, exampleRows, authoring } = buildHarness()
    const override = { upsertOwnedDefinition: jest.fn() }
    container.register({
      workflowDefinitionAuthoring: asValue(override),
      workflowExampleAuthoring: asValue(authoring),
    })

    await seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope)

    expect([...exampleRows.keys()]).toEqual(exampleIds)
    expect(override.upsertOwnedDefinition).not.toHaveBeenCalled()
  })

  test('fails setup when an enabled legacy override has no owner fallback', async () => {
    const { em, commandBus, container } = buildHarness()
    container.register('workflowDefinitionAuthoring', asValue({ upsertOwnedDefinition: jest.fn() }))

    await expect(seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope))
      .rejects.toThrow('Workflow example authoring is unavailable')
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  test('propagates a fallback resolution failure', async () => {
    const { em, container } = buildHarness()
    container.register({
      workflowDefinitionAuthoring: asValue({}),
      workflowExampleAuthoring: {
        resolve: () => { throw new Error('[internal] Owner registration failed') },
      },
    })

    await expect(seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope))
      .rejects.toThrow('Owner registration failed')
  })

  test('recovers after the first fixture was saved and the second fixture failed', async () => {
    const { em, container, exampleRows } = buildHarness()
    em.transactional
      .mockImplementationOnce(em.transactional.getMockImplementation()!)
      .mockRejectedValueOnce(Object.assign(new Error('raw database error with fixture payload'), { code: '40001' }))

    await expect(seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope))
      .rejects.toMatchObject({ message: '[internal] Workflow example could not be saved.', code: '40001' })
    expect([...exampleRows.keys()]).toEqual([exampleIds[0]])
    const first = exampleRows.get(exampleIds[0])

    await seedAgentOrchestratorExamples(em as unknown as EntityManager, container, scope)

    expect([...exampleRows.keys()]).toEqual(exampleIds)
    expect(exampleRows.get(exampleIds[0])).toBe(first)
  })
})
