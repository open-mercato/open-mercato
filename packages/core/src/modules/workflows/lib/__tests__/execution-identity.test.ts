/**
 * The executor's acting identity (spec: workflow execution identity).
 *
 * `executeUpdateEntity` refuses without `context.userId` and then checks that
 * user's LIVE features, so whatever the executor puts in `evalContext.userId` IS
 * the run's permission ceiling. These tests pin both halves at the executor
 * boundary: no grant ⇒ the starting user (unchanged), a grant ⇒ the definition's
 * own principal, always.
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

jest.mock('../transition-handler', () => ({
  findValidTransitions: jest.fn(),
  executeTransition: jest.fn(),
}))

jest.mock('../compensation-handler', () => ({
  compensateWorkflow: jest.fn(),
}))

const resolvePrincipalMock = jest.fn<(...args: unknown[]) => Promise<string | null>>()
jest.mock('../../../auth/lib/executionPrincipal', () => ({
  normalizeFeatureList: (value: unknown) =>
    Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [],
  provisionExecutionPrincipal: jest.fn(),
  resolveExecutionPrincipalUserId: (...args: unknown[]) => resolvePrincipalMock(...args),
}))

import * as workflowExecutor from '../workflow-executor'

type TransitionHandlerMock = {
  findValidTransitions: jest.Mock
  executeTransition: jest.Mock
}

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const definitionId = '00000000-0000-4000-8000-000000000003'
const instanceId = '00000000-0000-4000-8000-000000000004'
const STARTER_USER = '00000000-0000-4000-8000-0000000000aa'
const PRINCIPAL_USER = '00000000-0000-4000-8000-0000000000bb'

const baseDefinition = {
  id: definitionId,
  workflowId: 'granted-workflow',
  workflowName: 'Granted Workflow',
  version: 1,
  enabled: true,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'work', stepName: 'Work', stepType: 'AUTOMATED' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 'start-to-work', fromStepId: 'start', toStepId: 'work', trigger: 'auto', priority: 0 },
      { transitionId: 'work-to-end', fromStepId: 'work', toStepId: 'end', trigger: 'auto', priority: 0 },
    ],
  },
  tenantId,
  organizationId,
} as unknown as WorkflowDefinition

describe('workflow execution identity', () => {
  let mockEm: EntityManager
  let mockContainer: AwilixContainer
  let transitionHandler: TransitionHandlerMock
  let instance: WorkflowInstance

  function setup(grantedFeatures: string[] | null) {
    instance = {
      id: instanceId,
      definitionId,
      workflowId: 'granted-workflow',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'start',
      context: {},
      metadata: { initiatedBy: STARTER_USER },
      tenantId,
      organizationId,
      startedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as WorkflowInstance

    const definition = { ...baseDefinition, grantedFeatures } as unknown as WorkflowDefinition
    ;(mockEm.findOne as jest.Mock).mockImplementation(async (...args: unknown[]) => {
      const where = args[1] as Record<string, unknown>
      if (where?.id === instanceId) return instance
      if (where?.id === definitionId) return definition
      return null
    })

    transitionHandler.findValidTransitions.mockImplementation(async (...args: unknown[]) => {
      const inst = args[1] as WorkflowInstance
      const next: Record<string, string> = { start: 'work', work: 'end' }
      const toStepId = next[inst.currentStepId]
      if (!toStepId) return []
      return [
        {
          isValid: true,
          transition: {
            transitionId: `${inst.currentStepId}-to-${toStepId}`,
            fromStepId: inst.currentStepId,
            toStepId,
            trigger: 'auto',
          },
        },
      ]
    })

    transitionHandler.executeTransition.mockImplementation(async (...args: unknown[]) => {
      const inst = args[2] as WorkflowInstance
      const toStepId = args[4] as string
      inst.currentStepId = toStepId
      return { success: true, nextStepId: toStepId }
    })
  }

  function actingUserIds(): Array<string | undefined> {
    return transitionHandler.executeTransition.mock.calls.map(
      (call) => (call[5] as { userId?: string })?.userId,
    )
  }

  beforeEach(() => {
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(async () => []),
      create: jest.fn((_entity: unknown, data: unknown) => data),
      persist: jest.fn(function persist(this: unknown) { return this }),
      flush: jest.fn(),
      transactional: jest.fn(async (callback: (trx: EntityManager) => Promise<unknown>) => callback(mockEm)),
    } as unknown as EntityManager
    mockContainer = { resolve: jest.fn() } as unknown as AwilixContainer
    transitionHandler = jest.requireMock('../transition-handler') as TransitionHandlerMock
    jest.clearAllMocks()
    resolvePrincipalMock.mockReset()
  })

  test('REGRESSION: a definition declaring no grant still runs as the starting user', async () => {
    setup(null)

    await workflowExecutor.executeWorkflow(mockEm, mockContainer, instanceId)

    expect(actingUserIds()).toEqual([STARTER_USER, STARTER_USER])
    expect(resolvePrincipalMock).not.toHaveBeenCalled()
  })

  test('a granted definition runs as its own principal, not as the admin who started it', async () => {
    setup(['customers.deals.view'])
    resolvePrincipalMock.mockResolvedValue(PRINCIPAL_USER)

    await workflowExecutor.executeWorkflow(mockEm, mockContainer, instanceId)

    expect(actingUserIds()).toEqual([PRINCIPAL_USER, PRINCIPAL_USER])
    expect(resolvePrincipalMock).toHaveBeenCalledWith(mockEm, `workflow:${definitionId}`, {
      tenantId,
      organizationId,
    })
  })

  test('an explicit ExecutionContext.userId cannot override a declared grant', async () => {
    setup(['customers.deals.view'])
    resolvePrincipalMock.mockResolvedValue(PRINCIPAL_USER)

    await workflowExecutor.executeWorkflow(mockEm, mockContainer, instanceId, {
      userId: '00000000-0000-4000-8000-0000000000cc',
    })

    expect(actingUserIds()).toEqual([PRINCIPAL_USER, PRINCIPAL_USER])
  })

  test('a declared grant with no provisioned principal FAILS the run rather than borrowing the starter', async () => {
    setup(['customers.deals.view'])
    resolvePrincipalMock.mockResolvedValue(null)

    await expect(
      workflowExecutor.executeWorkflow(mockEm, mockContainer, instanceId),
    ).rejects.toThrow('execution principal is not provisioned')

    expect(transitionHandler.executeTransition).not.toHaveBeenCalled()
  })
})
