jest.mock('../workflow-executor', () => ({
  startWorkflow: jest.fn(),
  executeWorkflow: jest.fn().mockResolvedValue(undefined),
}))
jest.mock('../../../api_keys/services/apiKeyService', () => ({
  withOnetimeApiKey: jest.fn().mockResolvedValue({ status: 200 }),
}))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: jest.fn(),
  findOneWithDecryption: jest.fn(),
}))

import { withOnetimeApiKey } from '../../../api_keys/services/apiKeyService'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { CodeWorkflowDefinition } from '@open-mercato/shared/modules/workflows'
import { clearCodeWorkflowRegistry, registerCodeWorkflowEntries } from '@open-mercato/shared/modules/workflows/code-registry'
import { findWithDecryption, findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { WorkflowDefinition, WorkflowEventTrigger, WorkflowInstance } from '../../data/entities'
import { executeActivity, executeCallApi, executeUpdateEntity, resolveCallApiRoleIds, resolveWorkflowPrincipalUserId } from '../activity-executor'
import { executeRegistryActivity } from '../activity-worker-handler'
import { clearWorkflowSafeCommandsForTests, registerWorkflowSafeCommands } from '../workflow-safe-commands'
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


describe('trigger-to-activity authorization boundary', () => {
  test.each(['CALL_API', 'UPDATE_ENTITY'] as const)('%s refuses a payload actor without a definition grant', async (activityType) => {
    const commandBus = { execute: jest.fn().mockResolvedValue({ result: {} }) }
    const rbacService = { userHasAllFeatures: jest.fn().mockResolvedValue(true) }
    const definition = {
      id: 'definition-boundary', workflowId: 'boundary-regression', version: 1,
      enabled: true, lifecycle: 'published', tenantId, organizationId,
      createdBy: 'definition-author', grantedFeatures: null,
      definition: {
        triggers: [{ triggerId: 'on-person', name: 'On person', eventPattern: eventName, enabled: true, priority: 0 }],
      },
    }
    mockFind.mockImplementation((async (_em: unknown, entity: unknown) => {
      if (entity === WorkflowDefinition) return [definition]
      if (typeof entity === 'function' && entity.name === 'UserRole') return [{ role: { id: 'victim-role' } }]
      if (typeof entity === 'function' && entity.name === 'Role') return [{ id: 'victim-role' }]
      return []
    }) as typeof findWithDecryption)
    jest.mocked(findOneWithDecryption).mockImplementation((async (_em: unknown, entity: unknown, where: Record<string, unknown>) => {
      if (entity === WorkflowDefinition) return definition
      if (typeof entity === 'function' && entity.name === 'User' && where.id === 'victim-user') return { id: 'victim-user' }
      return null
    }) as typeof findOneWithDecryption)
    const em = { fork: jest.fn() }
    em.fork.mockReturnValue(em)
    const container = {
      resolve: (name: string): unknown => {
        if (name === 'em') return em
        if (name === 'commandBus') return commandBus
        if (name === 'rbacService') return rbacService
        if (name === 'moduleConfigService') return { getValue: jest.fn().mockResolvedValue(null) }
        throw new Error('[internal] Unexpected authorization boundary dependency')
      },
    } as AwilixContainer
    registerWorkflowSafeCommands([
      { commandId: 'customers.people.update', requiredFeatures: ['customers.people.edit'], defaultEnabled: true },
    ])
    mockStart.mockImplementation(async (_em, options) => ({
      id: 'instance-boundary', definitionId: definition.id, workflowId: definition.workflowId,
      tenantId, organizationId, metadata: options.metadata, context: options.initialContext,
    }) as WorkflowInstance)

    try {
      const result = await processEventTriggers(em as unknown as EntityManager, container, {
        eventName, tenantId, organizationId,
        payload: { userId: 'victim-user', actorUserId: 'victim-user', id: 'person-boundary' },
      })
      expect(result.triggered).toBe(1)
      const instance = await mockStart.mock.results[0].value as WorkflowInstance
      const executionContext = mockExecute.mock.calls[0][3]
      const activityContext = {
        workflowInstance: instance, workflowContext: instance.context, userId: executionContext?.userId,
      }
      if (activityType === 'UPDATE_ENTITY') {
        await expect(executeUpdateEntity(em as unknown as EntityManager, {
          commandId: 'customers.people.update', input: { id: 'person-boundary', displayName: 'Unauthorized change' },
        }, activityContext, container)).rejects.toThrow('requires an authenticated workflow user')
      } else {
        await expect(executeCallApi(em as unknown as EntityManager, {
          endpoint: '/api/auth/users',
        }, activityContext, container)).rejects.toThrow('no traceable user roles')
      }
      expect(commandBus.execute).not.toHaveBeenCalled()
      expect(rbacService.userHasAllFeatures).not.toHaveBeenCalled()
      expect(withOnetimeApiKey).not.toHaveBeenCalled()
    } finally {
      clearWorkflowSafeCommandsForTests()
    }
  })
})


describe('persisted pre-fix event identities', () => {
  test.each(['legacy', 'embedded', 'code'])('refuses %s event identity before direct or queued activity dispatch', async (source) => {
    const instance = {
      id: 'legacy-instance', definitionId: 'legacy-definition', tenantId, organizationId,
      metadata: {
        initiatedBy: 'victim-user',
        labels: { trigger_id: 'persisted-trigger', trigger_source: source },
      },
      context: { userId: 'victim-user' },
    } as WorkflowInstance
    const activityContext = { workflowInstance: instance, workflowContext: instance.context, userId: 'victim-user' }
    const em = {} as EntityManager
    const container = { resolve: jest.fn() } as unknown as AwilixContainer
    const activity = { activityId: 'legacy-activity', activityType: 'SEND_EMAIL', config: {} }

    await expect(executeActivity(em, container, activity, activityContext)).rejects.toThrow('Untrusted legacy event-triggered workflow identity')
    await expect(executeRegistryActivity({ activityType: 'SEND_EMAIL', activityConfig: {} }, activityContext, { em, container })).rejects.toThrow('Untrusted legacy event-triggered workflow identity')
    await expect(executeUpdateEntity(em, { commandId: 'customers.people.update', input: { id: 'person' } }, activityContext, container)).rejects.toThrow('Untrusted legacy event-triggered workflow identity')
    await expect(executeCallApi(em, { endpoint: '/api/auth/users' }, activityContext, container)).rejects.toThrow('Untrusted legacy event-triggered workflow identity')
    await expect(resolveCallApiRoleIds(em, instance)).rejects.toThrow('Untrusted legacy event-triggered workflow identity')
    await expect(resolveWorkflowPrincipalUserId(em, instance)).rejects.toThrow('Untrusted legacy event-triggered workflow identity')
    expect(container.resolve).not.toHaveBeenCalled()
    expect(withOnetimeApiKey).not.toHaveBeenCalled()
    expect(findOneWithDecryption).not.toHaveBeenCalled()
  })
})
