import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { openFork, resumeBranchAfterActivities } from '../parallel-handler'
import { WorkflowBranchInstance, WorkflowEvent, WorkflowInstance } from '../../data/entities'

jest.mock('../step-handler', () => ({
  executeStep: jest.fn(),
}))

/**
 * Lightweight in-memory EntityManager stub covering exactly the surface
 * `openFork` touches. The full FORK→branches→JOIN execution path (interleaved
 * loop, wait-all, namespace merge, outputMapping) is verified end-to-end by the
 * integration tests TC-WF-015..022 against a real database.
 */
function makeEmStub() {
  const created: Array<{ entity: any; data: any }> = []
  const em: any = {
    create(entity: any, data: any) {
      const obj = { ...data, id: `gen-${created.length}` }
      created.push({ entity, data: obj })
      return obj
    },
    persist() {
      return em
    },
    async flush() {},
    async findOne() {
      return null
    },
    async find() {
      return []
    },
  }
  return { em, created }
}

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'

function makeInstance() {
  return {
    id: '00000000-0000-4000-8000-000000000010',
    definitionId: '00000000-0000-4000-8000-000000000020',
    tenantId,
    organizationId,
    status: 'RUNNING',
    currentStepId: 'fork',
    activeForkStepId: null as string | null,
    context: {},
    updatedAt: new Date(),
  } as any
}

function makeDefinition() {
  return {
    id: '00000000-0000-4000-8000-000000000020',
    definition: {
      steps: [
        { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: { joinStepId: 'join' } },
        { stepId: 'a', stepName: 'A', stepType: 'AUTOMATED' },
        { stepId: 'b', stepName: 'B', stepType: 'AUTOMATED' },
        { stepId: 'join', stepName: 'Join', stepType: 'PARALLEL_JOIN', config: { forkStepId: 'fork' } },
      ],
      transitions: [
        { transitionId: 't-fa', fromStepId: 'fork', toStepId: 'a', trigger: 'auto' },
        { transitionId: 't-fb', fromStepId: 'fork', toStepId: 'b', trigger: 'auto' },
        { transitionId: 't-aj', fromStepId: 'a', toStepId: 'join', trigger: 'auto' },
        { transitionId: 't-bj', fromStepId: 'b', toStepId: 'join', trigger: 'auto' },
      ],
    },
  } as any
}

describe('openFork', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('creates one ACTIVE branch per outgoing auto transition and parks the instance FORKED', async () => {
    const { em, created } = makeEmStub()
    const instance = makeInstance()
    const definition = makeDefinition()
    const forkStep = definition.definition.steps.find((s: any) => s.stepId === 'fork')

    await openFork(em, instance, definition, forkStep)

    const branches = created.filter((c) => c.entity === WorkflowBranchInstance).map((c) => c.data)
    expect(branches).toHaveLength(2)

    const byKey = Object.fromEntries(branches.map((b) => [b.branchKey, b]))
    expect(Object.keys(byKey).sort()).toEqual(['t-fa', 't-fb'])
    for (const branch of branches) {
      expect(branch.status).toBe('ACTIVE')
      expect(branch.forkStepId).toBe('fork')
      expect(branch.joinStepId).toBe('join')
      expect(branch.currentStepId).toBe('fork') // starts ON the fork; loop runs branch_key transition
      expect(branch.parentBranchId).toBeNull()
      expect(branch.contextNamespace).toEqual({})
      expect(branch.tenantId).toBe(tenantId)
      expect(branch.organizationId).toBe(organizationId)
      expect(branch.workflowInstanceId).toBe(instance.id)
    }

    expect(instance.status).toBe('FORKED')
    expect(instance.activeForkStepId).toBe('fork')

    const forkEvents = created.filter((c) => c.data.eventType === 'PARALLEL_FORK_OPENED')
    expect(forkEvents).toHaveLength(1)
    expect(forkEvents[0].data.eventData.branchKeys.sort()).toEqual(['t-fa', 't-fb'])
  })

  test('throws when the fork step is missing config.joinStepId', async () => {
    const { em } = makeEmStub()
    const instance = makeInstance()
    const definition = makeDefinition()
    const badFork = { stepId: 'fork', stepName: 'Fork', stepType: 'PARALLEL_FORK', config: {} }

    await expect(openFork(em, instance, definition, badFork)).rejects.toThrow(/joinStepId/)
  })
})

describe('resumeBranchAfterActivities', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('uses parent workflow metadata.initiatedBy when executing the resumed branch step', async () => {
    const executeStep = jest.requireMock('../step-handler').executeStep as jest.Mock
    executeStep.mockResolvedValue({ success: true })

    const instance = {
      ...makeInstance(),
      context: { orderId: 'order-123' },
      metadata: { initiatedBy: 'branch-user-123' },
    }
    const branch = {
      id: '00000000-0000-4000-8000-000000000030',
      workflowInstanceId: instance.id,
      status: 'WAITING_FOR_ACTIVITIES',
      branchKey: 'branch-a',
      currentStepId: 'async-step',
      pendingTransition: { transitionId: 'async-to-update', toStepId: 'update-order' },
      contextNamespace: { _pendingAsyncActivities: ['job-1'], branchValue: 'A' },
      tenantId,
      organizationId,
      updatedAt: new Date(),
    } as any
    const completedEvent = {
      eventData: {
        async: true,
        activityId: 'notify',
        output: { ok: true },
      },
    } as any

    const em: any = {
      async findOne(entity: any) {
        if (entity === WorkflowBranchInstance) return branch
        if (entity === WorkflowInstance) return instance
        return null
      },
      async find(entity: any) {
        return entity === WorkflowEvent ? [completedEvent] : []
      },
      count: jest.fn().mockResolvedValue(0),
      flush: jest.fn().mockResolvedValue(undefined),
    }
    const container = { resolve: jest.fn() } as any

    const result = await resumeBranchAfterActivities(em, container, instance.id, branch.id)

    expect(result).toEqual({ continueExecution: true })
    expect(branch.currentStepId).toBe('update-order')
    expect(branch.status).toBe('ACTIVE')
    expect(branch.contextNamespace).toEqual({
      branchValue: 'A',
      notify_result: { ok: true },
    })
    expect(executeStep).toHaveBeenCalledWith(
      em,
      instance,
      'update-order',
      expect.objectContaining({
        workflowContext: {
          orderId: 'order-123',
          branchValue: 'A',
          notify_result: { ok: true },
        },
        userId: 'branch-user-123',
      }),
      container,
      branch,
    )
  })
})
