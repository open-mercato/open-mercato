/**
 * `workflows.instance.paused` / `workflows.instance.resumed` bus emission (#7186).
 *
 * Both are emitted at INSTANCE level only, once per actual `→ PAUSED` /
 * `PAUSED → RUNNING` transition, with the same identity-only payload as the
 * other lifecycle events. A re-park of an already-parked instance and a
 * branch-only park (the instance stays FORKED) publish nothing.
 */

import { describe, test, expect, jest, beforeEach, afterAll } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { setGlobalEventBus } from '@open-mercato/shared/modules/events'
import * as stepHandler from '../step-handler'
import { emitInstanceParkTransition } from '../instance-lifecycle-events'
import type {
  StepInstance,
  WorkflowBranchInstance,
  WorkflowDefinition,
  WorkflowInstance,
  WorkflowInstanceStatus,
} from '../../data/entities'

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const definitionId = '00000000-0000-4000-8000-000000000003'
const instanceId = '00000000-0000-4000-8000-000000000004'

const IDENTITY_KEYS = ['id', 'organizationId', 'status', 'stepId', 'tenantId', 'version', 'workflowId']

function makeInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: instanceId,
    definitionId,
    workflowId: 'park-workflow',
    version: 3,
    status: 'RUNNING',
    currentStepId: 'wait',
    context: { secret: 'must-not-leak', customer: { email: 'a@example.com' } },
    metadata: { note: 'must-not-leak' },
    tenantId,
    organizationId,
    startedAt: new Date(),
    retryCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WorkflowInstance
}

const definition: Partial<WorkflowDefinition> = {
  id: definitionId,
  workflowId: 'park-workflow',
  workflowName: 'Park Workflow',
  version: 3,
  enabled: true,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: 'wait',
        stepName: 'Wait',
        stepType: 'WAIT_FOR_SIGNAL',
        signalConfig: { signalName: 'go' },
      },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 't1', fromStepId: 'start', toStepId: 'wait', trigger: 'auto', priority: 0 },
      { transitionId: 't2', fromStepId: 'wait', toStepId: 'end', trigger: 'auto', priority: 0 },
    ],
  },
  tenantId,
  organizationId,
}

let busEmit: jest.Mock

function busCallsFor(eventId: string): Array<[string, Record<string, unknown>, unknown]> {
  return busEmit.mock.calls.filter((call) => call[0] === eventId) as never
}

beforeEach(() => {
  jest.clearAllMocks()
  busEmit = jest.fn(async () => {})
  setGlobalEventBus({ emit: busEmit as never })
})

afterAll(() => {
  setGlobalEventBus({ emit: async () => {} })
})

describe('emitInstanceParkTransition', () => {
  test('RUNNING → PAUSED emits paused once with an identity-only payload', async () => {
    const instance = makeInstance({ status: 'PAUSED' })

    await emitInstanceParkTransition(instance, 'RUNNING')

    expect(busEmit).toHaveBeenCalledTimes(1)
    const [[, payload, options]] = busCallsFor('workflows.instance.paused')
    expect(Object.keys(payload).sort()).toEqual(IDENTITY_KEYS)
    expect(payload).toEqual({
      id: instanceId,
      tenantId,
      organizationId,
      workflowId: 'park-workflow',
      version: 3,
      status: 'PAUSED',
      stepId: 'wait',
    })
    expect(options).toMatchObject({ persistent: true })
  })

  test('PAUSED → RUNNING emits resumed once with an identity-only payload', async () => {
    const instance = makeInstance({ status: 'RUNNING' })

    await emitInstanceParkTransition(instance, 'PAUSED')

    expect(busEmit).toHaveBeenCalledTimes(1)
    const [[, payload]] = busCallsFor('workflows.instance.resumed')
    expect(Object.keys(payload).sort()).toEqual(IDENTITY_KEYS)
    expect(payload).toMatchObject({ id: instanceId, status: 'RUNNING', stepId: 'wait' })
  })

  test.each<[WorkflowInstanceStatus, WorkflowInstanceStatus]>([
    ['PAUSED', 'PAUSED'],
    ['RUNNING', 'RUNNING'],
    ['FORKED', 'FORKED'],
    ['WAITING_FOR_ACTIVITIES', 'RUNNING'],
    ['FAILED', 'RUNNING'],
    ['FORKED', 'RUNNING'],
    ['PAUSED', 'CANCELLED'],
    ['PAUSED', 'FAILED'],
    ['RUNNING', 'WAITING_FOR_ACTIVITIES'],
  ])('%s → %s publishes nothing', async (previous, next) => {
    await emitInstanceParkTransition(makeInstance({ status: next }), previous)

    expect(busEmit).not.toHaveBeenCalled()
  })

  test('a failing bus never throws', async () => {
    busEmit.mockRejectedValue(new Error('bus down') as never)

    await expect(
      emitInstanceParkTransition(makeInstance({ status: 'PAUSED' }), 'RUNNING'),
    ).resolves.toBeUndefined()
  })
})

describe('step park sites', () => {
  let mockEm: jest.Mocked<EntityManager>

  beforeEach(() => {
    mockEm = {
      findOne: jest.fn(async () => definition),
      find: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn((_entity: unknown, data: Record<string, unknown>) => ({ id: 'step-instance-1', ...data })),
      persist: jest.fn(function persist(this: unknown) {
        return this
      }),
      flush: jest.fn(),
    } as never
  })

  test('parking a RUNNING instance on WAIT_FOR_SIGNAL emits paused exactly once', async () => {
    const instance = makeInstance({ status: 'RUNNING' })

    const result = await stepHandler.executeStep(mockEm, instance, 'wait', { workflowContext: {} })

    expect(result.status).toBe('WAITING')
    expect(instance.status).toBe('PAUSED')
    expect(busCallsFor('workflows.instance.paused')).toHaveLength(1)
    expect(busCallsFor('workflows.instance.paused')[0][1]).toMatchObject({
      id: instanceId,
      status: 'PAUSED',
      stepId: 'wait',
    })
    expect(busCallsFor('workflows.instance.resumed')).toHaveLength(0)
  })

  test('re-parking an instance that is already PAUSED emits nothing', async () => {
    const instance = makeInstance({ status: 'PAUSED' })

    await stepHandler.executeStep(mockEm, instance, 'wait', { workflowContext: {} })

    expect(instance.status).toBe('PAUSED')
    expect(busCallsFor('workflows.instance.paused')).toHaveLength(0)
  })

  test('a branch-only park leaves the instance FORKED and emits nothing', async () => {
    const instance = makeInstance({ status: 'FORKED' })
    const branch = {
      id: 'branch-1',
      workflowInstanceId: instanceId,
      status: 'ACTIVE',
      currentStepId: 'wait',
      tenantId,
      organizationId,
    } as unknown as WorkflowBranchInstance

    await stepHandler.executeStep(mockEm, instance, 'wait', { workflowContext: {} }, undefined, branch)

    expect(branch.status).toBe('PAUSED')
    expect(instance.status).toBe('FORKED')
    expect(busCallsFor('workflows.instance.paused')).toHaveLength(0)
  })

  test('a park → resume → park cycle emits paused twice and resumed once', async () => {
    const instance = makeInstance({ status: 'RUNNING' })

    await stepHandler.executeStep(mockEm, instance, 'wait', { workflowContext: {} })
    const previous = instance.status
    instance.status = 'RUNNING'
    await emitInstanceParkTransition(instance, previous)
    await stepHandler.executeStep(mockEm, instance, 'wait', { workflowContext: {} })

    expect(busEmit.mock.calls.map((call) => call[0]).filter((id) => /paused|resumed/.test(String(id)))).toEqual([
      'workflows.instance.paused',
      'workflows.instance.resumed',
      'workflows.instance.paused',
    ])
  })

  test('parking keeps the audit row alongside the bus event', async () => {
    const instance = makeInstance({ status: 'RUNNING' })
    const created: Array<Record<string, unknown>> = []
    mockEm.create.mockImplementation(((_entity: unknown, data: Record<string, unknown>) => {
      created.push(data)
      return { id: 'step-instance-1', ...data } as StepInstance
    }) as never)

    await stepHandler.executeStep(mockEm, instance, 'wait', { workflowContext: {} })

    expect(created.some((row) => row.eventType === 'SIGNAL_AWAITING')).toBe(true)
    expect(busCallsFor('workflows.instance.paused')).toHaveLength(1)
  })
})
