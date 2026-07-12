/**
 * Instance lifecycle bus emission tests (spec 2026-06-26)
 *
 * The executor must publish the declared `workflows.instance.*` events to the
 * event bus at its existing lifecycle transitions — alongside, never instead
 * of, the internal `WorkflowEvent` audit row — and a bus failure must never
 * break workflow execution.
 */

import { describe, test, expect, jest, beforeEach, afterAll } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import * as workflowExecutor from '../workflow-executor'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

jest.mock('../compensation-handler', () => ({
  compensateWorkflow: jest.fn(),
}))

jest.mock('../transition-handler', () => ({
  findValidTransitions: jest.fn(),
  executeTransition: jest.fn(),
}))

describe('workflows.instance.* lifecycle bus emission', () => {
  const testTenantId = '00000000-0000-4000-8000-000000000001'
  const testOrgId = '00000000-0000-4000-8000-000000000002'
  const testDefinitionId = '00000000-0000-4000-8000-000000000003'
  const testInstanceId = '00000000-0000-4000-8000-000000000004'

  const mockDefinition: Partial<WorkflowDefinition> = {
    id: testDefinitionId,
    workflowId: 'lifecycle-workflow',
    workflowName: 'Lifecycle Workflow',
    version: 1,
    enabled: true,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        {
          transitionId: 'start-to-end',
          fromStepId: 'start',
          toStepId: 'end',
          trigger: 'auto',
          priority: 0,
        },
      ],
    },
    tenantId: testTenantId,
    organizationId: testOrgId,
  }

  function makeInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
    return {
      id: testInstanceId,
      definitionId: testDefinitionId,
      workflowId: 'lifecycle-workflow',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'start',
      context: {},
      tenantId: testTenantId,
      organizationId: testOrgId,
      startedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as WorkflowInstance
  }

  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let busEmit: jest.Mock

  beforeEach(() => {
    jest.clearAllMocks()
    busEmit = jest.fn(async () => {})
    setGlobalEventBus({ emit: busEmit as never })

    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      persist: jest.fn(function persist(this: unknown) {
        return this
      }),
      flush: jest.fn(),
      transactional: jest.fn(async (callback: (trx: EntityManager) => Promise<unknown>) =>
        callback(mockEm)
      ),
    } as never

    mockContainer = { resolve: jest.fn() } as never
  })

  afterAll(() => {
    setGlobalEventBus({ emit: async () => {} })
  })

  function busCallsFor(eventId: string): Array<[string, Record<string, unknown>, unknown]> {
    return busEmit.mock.calls.filter((call) => call[0] === eventId) as never
  }

  describe('startWorkflow', () => {
    test('emits created and started with the tenant-scoped payload', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition as never)
      mockEm.create.mockImplementation(((entity: unknown, data: Record<string, unknown>) => {
        return typeof entity === 'function' && (entity as { name?: string }).name === 'WorkflowInstance'
          ? makeInstance(data as Partial<WorkflowInstance>)
          : data
      }) as never)

      await workflowExecutor.startWorkflow(mockEm, {
        workflowId: 'lifecycle-workflow',
        initialContext: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      const created = busCallsFor('workflows.instance.created')
      const started = busCallsFor('workflows.instance.started')
      expect(created).toHaveLength(1)
      expect(started).toHaveLength(1)
      for (const [, payload, options] of [...created, ...started]) {
        expect(payload).toMatchObject({
          id: testInstanceId,
          tenantId: testTenantId,
          organizationId: testOrgId,
          workflowId: 'lifecycle-workflow',
          version: 1,
          status: 'RUNNING',
        })
        expect(options).toMatchObject({ persistent: true })
      }
    })

    test('a failing bus never breaks startWorkflow', async () => {
      busEmit.mockRejectedValue(new Error('bus down') as never)
      mockEm.findOne.mockResolvedValue(mockDefinition as never)
      mockEm.create.mockImplementation(((entity: unknown, data: Record<string, unknown>) => {
        return typeof entity === 'function' && (entity as { name?: string }).name === 'WorkflowInstance'
          ? makeInstance(data as Partial<WorkflowInstance>)
          : data
      }) as never)

      const instance = await workflowExecutor.startWorkflow(mockEm, {
        workflowId: 'lifecycle-workflow',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(instance.status).toBe('RUNNING')
    })
  })

  describe('completeWorkflow', () => {
    test('COMPLETED emits workflows.instance.completed exactly once', async () => {
      const instance = makeInstance({ currentStepId: 'end' })
      mockEm.findOne.mockResolvedValueOnce(instance as never)

      await workflowExecutor.completeWorkflow(mockEm, mockContainer, testInstanceId, 'COMPLETED')

      const completed = busCallsFor('workflows.instance.completed')
      expect(completed).toHaveLength(1)
      expect(completed[0][1]).toMatchObject({
        id: testInstanceId,
        tenantId: testTenantId,
        organizationId: testOrgId,
        status: 'COMPLETED',
        stepId: 'end',
      })
      expect(busCallsFor('workflows.instance.failed')).toHaveLength(0)
      // Audit coexistence: the internal WorkflowEvent row is still written
      expect(mockEm.persist).toHaveBeenCalled()
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('FAILED (no compensation) emits workflows.instance.failed exactly once', async () => {
      const instance = makeInstance()
      mockEm.findOne
        .mockResolvedValueOnce(instance as never)
        .mockResolvedValueOnce(mockDefinition as never)

      await workflowExecutor.completeWorkflow(mockEm, mockContainer, testInstanceId, 'FAILED', {
        error: 'boom',
      })

      const failed = busCallsFor('workflows.instance.failed')
      expect(failed).toHaveLength(1)
      expect(failed[0][1]).toMatchObject({
        id: testInstanceId,
        tenantId: testTenantId,
        organizationId: testOrgId,
        status: 'FAILED',
      })
      expect(busCallsFor('workflows.instance.completed')).toHaveLength(0)
    })

    test('CANCELLED emits workflows.instance.cancelled exactly once', async () => {
      const instance = makeInstance()
      mockEm.findOne.mockResolvedValueOnce(instance as never)

      await workflowExecutor.completeWorkflow(mockEm, mockContainer, testInstanceId, 'CANCELLED')

      expect(busCallsFor('workflows.instance.cancelled')).toHaveLength(1)
      expect(busCallsFor('workflows.instance.failed')).toHaveLength(0)
      expect(busCallsFor('workflows.instance.completed')).toHaveLength(0)
    })
  })

  describe('executeWorkflow', () => {
    test('full run emits step-advance started and terminal completed', async () => {
      const instance = makeInstance()
      const transitionHandler = jest.mocked(await import('../transition-handler'))
      transitionHandler.findValidTransitions.mockResolvedValue([
        {
          isValid: true,
          transition: mockDefinition.definition!.transitions[0],
        },
      ] as never)
      transitionHandler.executeTransition.mockImplementation((async () => {
        instance.currentStepId = 'end'
        return { success: true }
      }) as never)

      mockEm.findOne.mockImplementation((async (entity: unknown) => {
        const name = typeof entity === 'function' ? (entity as { name?: string }).name : String(entity)
        if (name === 'WorkflowDefinition') return mockDefinition
        return instance
      }) as never)

      const result = await workflowExecutor.executeWorkflow(mockEm, mockContainer, testInstanceId)

      expect(result.status).toBe('COMPLETED')
      const stepAdvances = busCallsFor('workflows.instance.started')
      expect(stepAdvances).toHaveLength(1)
      expect(stepAdvances[0][1]).toMatchObject({
        id: testInstanceId,
        stepId: 'end',
        fromStepId: 'start',
      })
      expect(busCallsFor('workflows.instance.completed')).toHaveLength(1)
      expect(busCallsFor('workflows.instance.failed')).toHaveLength(0)
    })
  })
})
