jest.mock('../workflow-executor', () => ({
  startWorkflow: jest.fn(),
  executeWorkflow: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
}))

import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { clearCodeWorkflowRegistry, registerCodeWorkflowEntries } from '@open-mercato/shared/modules/workflows/code-registry'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition, WorkflowEventTrigger } from '../../data/entities'
import { startWorkflow, executeWorkflow } from '../workflow-executor'
import { invalidateTriggerCache, processEventTriggers, resetTriggerDebounceState } from '../event-trigger-service'

const tenantId = 'tenant-identity'
const organizationId = 'org-identity'
const eventName = 'customers.person.created'
const actorPayloads = [
  { userId: 'victim-user' },
  { actorUserId: 'victim-actor' },
  { userId: 'victim-user', actorUserId: 'victim-actor' },
  { userId: '  victim-user  ' },
  {},
]

const mockFind = jest.mocked(findWithDecryption)
const mockStart = jest.mocked(startWorkflow)
const mockExecute = jest.mocked(executeWorkflow)

beforeEach(() => {
  jest.clearAllMocks()
  clearCodeWorkflowRegistry()
  invalidateTriggerCache(tenantId, organizationId)
  resetTriggerDebounceState()
  mockStart.mockResolvedValue({ id: 'instance-identity' } as Awaited<ReturnType<typeof startWorkflow>>)
})

afterEach(() => {
  clearCodeWorkflowRegistry()
  invalidateTriggerCache(tenantId, organizationId)
  resetTriggerDebounceState()
})

describe.each(['legacy', 'embedded', 'code'] as const)('%s trigger identity', (source) => {
  test.each(actorPayloads)('keeps payload %j as data, never as an execution principal', async (actorFields) => {
    const trigger = {
      triggerId: 'on-person',
      name: 'On person',
      eventPattern: eventName,
      enabled: true,
      priority: 0,
      config: {
        contextMapping: [{ targetKey: 'userId', sourceExpression: 'actorUserId' }],
      },
    }
    const definition = {
      id: 'definition-identity', workflowId: 'identity-regression', version: 1,
      enabled: true, lifecycle: 'published', tenantId, organizationId,
      definition: { steps: [], transitions: [], triggers: source === 'embedded' ? [trigger] : [] },
    }
    const legacy = {
      ...trigger, id: 'legacy-identity', workflowDefinitionId: definition.id,
      tenantId, organizationId,
    }
    mockFind.mockImplementation((async (_em: unknown, entity: unknown) => {
      if (entity === WorkflowEventTrigger) return source === 'legacy' ? [legacy] : []
      if (entity === WorkflowDefinition) return source === 'code' ? [] : [definition]
      return []
    }) as typeof findWithDecryption)
    if (source === 'code') {
      const codeDefinition = {
        ...definition, moduleId: 'customers', workflowName: 'Identity regression',
        description: null, metadata: null,
        definition: { ...definition.definition, triggers: [trigger] },
      } as unknown as CodeWorkflowDefinition
      registerCodeWorkflowEntries([codeDefinition])
    }
    const em = { fork: jest.fn() }
    em.fork.mockReturnValue(em)
    const container = {} as AwilixContainer
    const payload = { id: 'person-identity', ...actorFields }

    const result = await processEventTriggers(em as unknown as EntityManager, container, {
      eventName, payload, tenantId, organizationId,
    })

    expect(result.errors).toEqual([])
    expect(result.triggered).toBe(1)
    const startOptions = mockStart.mock.calls[0][1]
    expect(startOptions.metadata?.initiatedBy).toBe(`trigger:${result.instances[0].triggerId}`)
    expect(startOptions.initialContext?.__trigger).toEqual(expect.objectContaining({ eventPayload: payload, source }))
    expect(mockExecute).toHaveBeenCalledWith(em, container, 'instance-identity', undefined)
  })
})
