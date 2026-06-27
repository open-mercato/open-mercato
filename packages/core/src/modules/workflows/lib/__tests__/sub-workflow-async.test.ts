/**
 * Suspendable SUB_WORKFLOW tests (Fix #2).
 *
 * A SUB_WORKFLOW step whose child parks at its first async/agent step must park
 * the parent (NOT fail it). The child's terminal completeWorkflow enqueues a
 * `resume_subworkflow_parent` job that resumes (or fails) the parent.
 *
 * Covers:
 *  - handleSubWorkflowStep parks the parent on a non-terminal child + logs
 *    SIGNAL_AWAITING with SUB_WORKFLOW_SIGNAL_NAME
 *  - resumeParentAfterSubWorkflow: COMPLETED child maps output + resumes via signal
 *  - resumeParentAfterSubWorkflow: FAILED child fails the parent
 *  - idempotency skip when the parent already advanced
 *  - fully-synchronous child still completes inline (regression)
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

const enqueueMock = jest.fn<Promise<string>, [unknown, unknown?]>()
const sendSignalMock = jest.fn<Promise<void>, [unknown, unknown, unknown]>()
const completeWorkflowMock = jest.fn<Promise<void>, [unknown, unknown, string, string, unknown?]>()

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue: enqueueMock })),
}))

jest.mock('../signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignalMock(args[0], args[1], args[2]),
}))

import * as stepHandler from '../step-handler'
import * as workflowExecutor from '../workflow-executor'
import { resumeParentAfterSubWorkflow } from '../activity-worker-handler'
import { SUB_WORKFLOW_SIGNAL_NAME } from '../activity-executor'
import type { WorkflowActivityJobResumeSubWorkflowParent } from '../activity-queue-types'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const parentDefinitionId = '00000000-0000-4000-8000-000000000003'
const parentInstanceId = '00000000-0000-4000-8000-000000000004'
const childInstanceId = '00000000-0000-4000-8000-000000000006'
const stepInstanceId = '00000000-0000-4000-8000-000000000007'
const parentStepId = 'invoke-child'

const parentDefinition: Partial<WorkflowDefinition> = {
  id: parentDefinitionId,
  workflowId: 'parent-workflow',
  version: 1,
  enabled: true,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      {
        stepId: parentStepId,
        stepName: 'Invoke Child',
        stepType: 'SUB_WORKFLOW',
        config: {
          subWorkflowId: 'child-workflow',
          version: 1,
          inputMapping: { childOrderId: 'orderId' },
          outputMapping: { parentResult: 'childResult' },
        },
      },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { fromStepId: 'start', toStepId: parentStepId, trigger: 'auto' },
      { fromStepId: parentStepId, toStepId: 'end', trigger: 'auto' },
    ],
  } as any,
}

const parentInstance: Partial<WorkflowInstance> = {
  id: parentInstanceId,
  definitionId: parentDefinitionId,
  workflowId: 'parent-workflow',
  version: 1,
  status: 'RUNNING',
  currentStepId: parentStepId,
  context: { orderId: '12345' },
  tenantId,
  organizationId,
}

const childInstance: Partial<WorkflowInstance> = {
  id: childInstanceId,
  workflowId: 'child-workflow',
  status: 'RUNNING',
  currentStepId: 'agent-step',
  context: { orderId: '12345' },
  tenantId,
  organizationId,
}

function makeResumeJob(
  overrides: Partial<WorkflowActivityJobResumeSubWorkflowParent> = {}
): WorkflowActivityJobResumeSubWorkflowParent {
  return {
    kind: 'resume_subworkflow_parent',
    workflowInstanceId: parentInstanceId,
    parentInstanceId,
    parentStepId,
    parentStepInstanceId: stepInstanceId,
    childInstanceId,
    childStatus: 'COMPLETED',
    tenantId,
    organizationId,
    ...overrides,
  }
}

beforeEach(() => {
  enqueueMock.mockReset().mockResolvedValue('job-1')
  sendSignalMock.mockReset().mockResolvedValue(undefined)
  completeWorkflowMock.mockReset().mockResolvedValue(undefined)
  jest.clearAllMocks()
})

describe('handleSubWorkflowStep parks the parent on a non-terminal child', () => {
  function makeEm(): EntityManager {
    const em = {
      findOne: jest.fn().mockResolvedValue(parentDefinition),
      create: jest.fn((_entity: any, data: any) => ({ ...data, id: stepInstanceId })),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager
    return em
  }

  test('parks the parent (status PAUSED, WAITING result) instead of failing it', async () => {
    const em = makeEm()
    const instance = { ...parentInstance } as WorkflowInstance

    const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      .mockResolvedValue({ ...childInstance } as WorkflowInstance)
    const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')
      .mockResolvedValue({
        status: 'RUNNING', // child parked at its agent step (non-terminal)
        currentStep: 'agent-step',
        context: childInstance.context!,
        events: [],
        executionTime: 10,
      })

    const result = await stepHandler.executeStep(
      em,
      instance,
      parentStepId,
      { workflowContext: instance.context! },
      {} as AwilixContainer,
    )

    expect(result.status).toBe('WAITING')
    expect(result.waitReason).toBe('SIGNAL')
    expect((result.outputData as any).childInstanceId).toBe(childInstanceId)
    expect(instance.status).toBe('PAUSED')

    // SIGNAL_AWAITING logged with the sub-workflow signal name
    const createCalls = (em.create as jest.Mock).mock.calls
    const signalAwaiting = createCalls.find(
      ([, data]: any[]) => data?.eventType === 'SIGNAL_AWAITING',
    )
    expect(signalAwaiting).toBeDefined()
    expect(signalAwaiting![1].eventData.signalName).toBe(SUB_WORKFLOW_SIGNAL_NAME)
    expect(signalAwaiting![1].eventData.reason).toBe('SUB_WORKFLOW')

    startWorkflowSpy.mockRestore()
    executeWorkflowSpy.mockRestore()
  })

  test('a fully-synchronous child still completes inline (regression)', async () => {
    const em = makeEm()
    const instance = { ...parentInstance } as WorkflowInstance

    const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      .mockResolvedValue({ ...childInstance } as WorkflowInstance)
    const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')
      .mockResolvedValue({
        status: 'COMPLETED',
        currentStep: 'end',
        context: { childResult: 'ok' },
        events: [],
        executionTime: 10,
      })

    const result = await stepHandler.executeStep(
      em,
      instance,
      parentStepId,
      { workflowContext: instance.context! },
      {} as AwilixContainer,
    )

    expect(result.status).toBe('COMPLETED')
    expect((result.outputData as any).parentResult).toBe('ok')
    expect(instance.status).not.toBe('PAUSED')

    startWorkflowSpy.mockRestore()
    executeWorkflowSpy.mockRestore()
  })
})

describe('resumeParentAfterSubWorkflow', () => {
  function makeEm(
    parent: Record<string, unknown> | null,
    child: Record<string, unknown> | null = childInstance as any,
    def: Partial<WorkflowDefinition> | null = parentDefinition,
  ): EntityManager {
    const findOne = jest.fn(async (entity: any, where: any) => {
      const name = typeof entity === 'function' ? entity.name : entity
      if (name === 'WorkflowInstance') {
        if (where?.id === parentInstanceId) return parent
        if (where?.id === childInstanceId) return child
        return null
      }
      if (name === 'WorkflowDefinition') return def
      if (name === 'StepInstance') return { id: stepInstanceId, status: 'ACTIVE' }
      return null
    })
    return {
      findOne,
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn((_e: any, data: any) => ({ ...data, id: 'evt' })),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager
  }

  test('COMPLETED child maps output and resumes the parent via signal', async () => {
    const em = makeEm(
      { id: parentInstanceId, definitionId: parentDefinitionId, currentStepId: parentStepId, status: 'PAUSED', context: {}, tenantId, organizationId },
      { id: childInstanceId, context: { childResult: 'mapped-value' }, tenantId, organizationId },
    )
    const container = {} as AwilixContainer

    await resumeParentAfterSubWorkflow(em, container, makeResumeJob())

    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { signalName: string; payload: Record<string, unknown> }]
    expect(options.signalName).toBe(SUB_WORKFLOW_SIGNAL_NAME)
    expect(options.payload).toEqual({ parentResult: 'mapped-value' })
  })

  test('FAILED child fails the parent (no signal)', async () => {
    const completeSpy = jest.spyOn(workflowExecutor, 'completeWorkflow').mockResolvedValue(undefined)
    const em = makeEm(
      { id: parentInstanceId, definitionId: parentDefinitionId, currentStepId: parentStepId, status: 'PAUSED', context: {}, tenantId, organizationId },
    )
    const container = {} as AwilixContainer

    await resumeParentAfterSubWorkflow(em, container, makeResumeJob({ childStatus: 'FAILED' }))

    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(completeSpy).toHaveBeenCalledWith(em, container, parentInstanceId, 'FAILED', expect.any(Object))
    completeSpy.mockRestore()
  })

  test('idempotency: skips (no signal, no throw) when the parent already advanced', async () => {
    const em = makeEm(
      { id: parentInstanceId, definitionId: parentDefinitionId, currentStepId: 'end', status: 'RUNNING', context: {}, tenantId, organizationId },
    )
    const container = {} as AwilixContainer

    await expect(resumeParentAfterSubWorkflow(em, container, makeResumeJob())).resolves.toBeUndefined()
    expect(sendSignalMock).not.toHaveBeenCalled()
  })

  test('retries (throws) when the parent has not parked yet', async () => {
    const em = makeEm(
      { id: parentInstanceId, definitionId: parentDefinitionId, currentStepId: parentStepId, status: 'RUNNING', context: {}, tenantId, organizationId },
    )
    const container = {} as AwilixContainer

    await expect(resumeParentAfterSubWorkflow(em, container, makeResumeJob())).rejects.toThrow(/not parked yet/)
    expect(sendSignalMock).not.toHaveBeenCalled()
  })
})
