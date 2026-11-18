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

import { describe, test, expect, jest, beforeEach, afterAll } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'

const enqueueMock = jest.fn<Promise<string>, [unknown, unknown?]>()
const sendSignalMock = jest.fn<Promise<void>, [unknown, unknown, unknown]>()
const completeWorkflowMock = jest.fn<Promise<void>, [unknown, unknown, string, string, unknown?]>()
const compensateWorkflowMock = jest.fn<Promise<any>, [unknown, unknown, unknown, unknown, unknown?]>()

const mockLoggerInstance = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  child: jest.fn(),
}
mockLoggerInstance.child.mockImplementation(() => mockLoggerInstance)

jest.mock('@open-mercato/shared/lib/logger', () => ({
  createLogger: jest.fn(() => mockLoggerInstance),
}))

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: jest.fn(() => ({ enqueue: enqueueMock })),
}))

jest.mock('../signal-handler', () => ({
  sendSignal: (...args: unknown[]) => sendSignalMock(args[0], args[1], args[2]),
}))

jest.mock('../compensation-handler', () => ({
  compensateWorkflow: (...args: unknown[]) => compensateWorkflowMock(args[0], args[1], args[2], args[3], args[4]),
}))

import * as stepHandler from '../step-handler'
import * as workflowExecutor from '../workflow-executor'
import { resumeParentAfterSubWorkflow } from '../activity-worker-handler'
import { SUB_WORKFLOW_SIGNAL_NAME } from '../activity-executor'
import type { WorkflowActivityJobResumeSubWorkflowParent } from '../activity-queue-types'
import type { WorkflowDefinition, WorkflowInstance } from '../../data/entities'
import { codeWorkflowUuid } from '../find-definition'
import { registerCodeWorkflows, clearCodeWorkflowRegistry } from '../code-registry'

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
      { transitionId: 'start_to_child', fromStepId: 'start', toStepId: parentStepId, trigger: 'auto' },
      { transitionId: 'child_to_end', fromStepId: parentStepId, toStepId: 'end', trigger: 'auto' },
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
  compensateWorkflowMock.mockReset().mockResolvedValue({ status: 'COMPENSATED', compensatedActivities: 1, totalActivities: 1 })
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
    childDef: Record<string, unknown> | null = null,
  ): EntityManager {
    const findOne = jest.fn(async (entity: any, where: any) => {
      const name = typeof entity === 'function' ? entity.name : entity
      if (name === 'WorkflowInstance') {
        if (where?.id === parentInstanceId) return parent
        if (where?.id === childInstanceId) return child
        return null
      }
      if (name === 'WorkflowDefinition') {
        if (where?.workflowId) return childDef
        if (child && where?.id === child.definitionId) return childDef
        return def
      }
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

  describe('code-defined parent with no persisted definition row', () => {
    const codeParentDefinitionId = codeWorkflowUuid('parent-workflow')

    beforeEach(() => {
      clearCodeWorkflowRegistry()
      registerCodeWorkflows([
        {
          workflowId: 'parent-workflow',
          workflowName: 'Parent Workflow',
          version: 1,
          enabled: true,
          moduleId: 'test_module',
          definition: parentDefinition.definition,
        } as never,
      ])
    })

    afterAll(() => {
      clearCodeWorkflowRegistry()
    })

    test('maps the child output through the code-defined SUB_WORKFLOW step on resume', async () => {
      const em = makeEm(
        { id: parentInstanceId, definitionId: codeParentDefinitionId, workflowId: 'parent-workflow', currentStepId: parentStepId, status: 'PAUSED', context: {}, tenantId, organizationId },
        { id: childInstanceId, context: { childResult: 'code-mapped-value' }, tenantId, organizationId },
        null,
      )

      await resumeParentAfterSubWorkflow(em, {} as AwilixContainer, makeResumeJob())

      expect(sendSignalMock).toHaveBeenCalledTimes(1)
      const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { signalName: string; payload: Record<string, unknown> }]
      expect(options.signalName).toBe(SUB_WORKFLOW_SIGNAL_NAME)
      expect(options.payload).toEqual({ parentResult: 'code-mapped-value' })
    })

    test('a code-defined parent on v1 resumes with v1 outputMapping while v2 is latest (#7184)', async () => {
      registerCodeWorkflows([
        {
          workflowId: 'parent-workflow',
          workflowName: 'Parent Workflow v2',
          version: 2,
          enabled: true,
          moduleId: 'test_module',
          definition: {
            ...parentDefinition.definition!,
            steps: parentDefinition.definition!.steps.map((step) =>
              step.stepId === parentStepId
                ? { ...step, config: { ...step.config, outputMapping: { renamedInV2: 'childResult' } } }
                : step,
            ),
          },
        } as never,
      ])
      const em = makeEm(
        { id: parentInstanceId, definitionId: codeParentDefinitionId, workflowId: 'parent-workflow', version: 1, currentStepId: parentStepId, status: 'PAUSED', context: {}, tenantId, organizationId },
        { id: childInstanceId, context: { childResult: 'v1-mapped-value' }, tenantId, organizationId },
        null,
      )

      await resumeParentAfterSubWorkflow(em, {} as AwilixContainer, makeResumeJob())

      expect(sendSignalMock).toHaveBeenCalledTimes(1)
      const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { payload: Record<string, unknown> }]
      expect(options.payload).toEqual({ parentResult: 'v1-mapped-value' })
    })

    test('a persisted definition row still wins over the code registry', async () => {
      const persistedOverride: Partial<WorkflowDefinition> = {
        ...parentDefinition,
        id: codeParentDefinitionId,
        definition: {
          ...parentDefinition.definition!,
          steps: parentDefinition.definition!.steps.map((step) =>
            step.stepId === parentStepId
              ? { ...step, config: { ...step.config, outputMapping: { overriddenResult: 'childResult' } } }
              : step,
          ),
        },
      }
      const em = makeEm(
        { id: parentInstanceId, definitionId: codeParentDefinitionId, workflowId: 'parent-workflow', currentStepId: parentStepId, status: 'PAUSED', context: {}, tenantId, organizationId },
        { id: childInstanceId, context: { childResult: 'db-mapped-value' }, tenantId, organizationId },
        persistedOverride,
      )

      await resumeParentAfterSubWorkflow(em, {} as AwilixContainer, makeResumeJob())

      expect(sendSignalMock).toHaveBeenCalledTimes(1)
      const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { payload: Record<string, unknown> }]
      expect(options.payload).toEqual({ overriddenResult: 'db-mapped-value' })
    })
  })

  describe('with declared child output ports', () => {
    const parkedParent = () => ({
      id: parentInstanceId, definitionId: parentDefinitionId, currentStepId: parentStepId, status: 'PAUSED', context: {}, tenantId, organizationId,
    })

    function parentWithOutputMapping(outputMapping: Record<string, string>): Partial<WorkflowDefinition> {
      const definition = parentDefinition.definition!
      const steps = definition.steps.map((step) =>
        step.stepId === parentStepId ? { ...step, config: { ...step.config, outputMapping } } : step,
      )
      return { ...parentDefinition, definition: { ...definition, steps } }
    }

    const childDefWithOutputs = {
      id: '00000000-0000-4000-8000-000000000008',
      workflowId: 'child-workflow',
      version: 1,
      enabled: true,
      definition: {
        steps: [],
        transitions: [],
        io: {
          outputs: [
            { name: 'childValue', type: 'text', label: 'Child Value', required: true },
            { name: 'childAmount', type: 'number', label: 'Child Amount' },
          ],
        },
      },
      tenantId,
      organizationId,
    }

    test('renamed required port resumes the parent with the renamed, coerced keys', async () => {
      const em = makeEm(
        parkedParent(),
        { id: childInstanceId, definitionId: childDefWithOutputs.id, context: { childValue: 'port-alpha', childAmount: '12.5' }, tenantId, organizationId },
        parentWithOutputMapping({ renamedValue: 'childValue', renamedAmount: 'childAmount' }),
        childDefWithOutputs,
      )

      await resumeParentAfterSubWorkflow(em, {} as AwilixContainer, makeResumeJob())

      expect(sendSignalMock).toHaveBeenCalledTimes(1)
      const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { signalName: string; payload: Record<string, unknown> }]
      expect(options.signalName).toBe(SUB_WORKFLOW_SIGNAL_NAME)
      expect(options.payload).toEqual({ renamedValue: 'port-alpha', renamedAmount: 12.5 })
    })

    test('identity mapping still resumes the parent', async () => {
      const em = makeEm(
        parkedParent(),
        { id: childInstanceId, definitionId: childDefWithOutputs.id, context: { childValue: 'port-alpha' }, tenantId, organizationId },
        parentWithOutputMapping({ childValue: 'childValue' }),
        childDefWithOutputs,
      )

      await resumeParentAfterSubWorkflow(em, {} as AwilixContainer, makeResumeJob())

      const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { payload: Record<string, unknown> }]
      expect(options.payload).toEqual({ childValue: 'port-alpha' })
    })

    test('missing required child port fails the parent instead of resuming it', async () => {
      const completeSpy = jest.spyOn(workflowExecutor, 'completeWorkflow').mockResolvedValue(undefined)
      const em = makeEm(
        parkedParent(),
        { id: childInstanceId, definitionId: childDefWithOutputs.id, context: { childAmount: 3 }, tenantId, organizationId },
        parentWithOutputMapping({ renamedValue: 'childValue' }),
        childDefWithOutputs,
      )
      const container = {} as AwilixContainer

      await resumeParentAfterSubWorkflow(em, container, makeResumeJob())

      expect(sendSignalMock).not.toHaveBeenCalled()
      expect(completeSpy).toHaveBeenCalledWith(em, container, parentInstanceId, 'FAILED', {
        error: 'Sub-workflow output validation failed: Required port "childValue" is missing',
      })
      completeSpy.mockRestore()
    })
  })
})

describe('completeWorkflow resumes the parent even when the failed child compensates', () => {
  // A child sub-workflow that FAILS and has compensatable activities takes the
  // early-return compensation path in completeWorkflow. Without enqueuing the
  // parent-resume there, a parent parked on this child would stay PAUSED forever.
  const compensatableChildDefinition: Partial<WorkflowDefinition> = {
    id: 'child-def',
    definition: {
      steps: [],
      transitions: [
        { fromStepId: 'a', toStepId: 'b', activities: [{ activityId: 'x', compensation: { activityId: 'undo-x' } }] },
      ],
    } as any,
  }

  const failedChildWithParent: Partial<WorkflowInstance> = {
    ...childInstance,
    status: 'FAILED',
    definitionId: 'child-def',
    metadata: { labels: { parentInstanceId, parentStepId, parentStepInstanceId: stepInstanceId } } as any,
  }

  function makeEm(): EntityManager {
    const findOne = jest.fn(async (entity: any) => {
      const name = typeof entity === 'function' ? entity.name : entity
      if (name === 'WorkflowInstance') return failedChildWithParent
      if (name === 'WorkflowDefinition') return compensatableChildDefinition
      return null
    })
    return { findOne, flush: jest.fn().mockResolvedValue(undefined) } as unknown as EntityManager
  }

  test('enqueues a resume_subworkflow_parent job (FAILED) on the compensation path', async () => {
    const em = makeEm()
    const container = {} as AwilixContainer

    await workflowExecutor.completeWorkflow(em, container, childInstanceId, 'FAILED', { error: 'boom' })

    expect(compensateWorkflowMock).toHaveBeenCalledTimes(1)
    expect(enqueueMock).toHaveBeenCalledTimes(1)
    const [job] = enqueueMock.mock.calls[0] as [WorkflowActivityJobResumeSubWorkflowParent, unknown]
    expect(job).toMatchObject({
      kind: 'resume_subworkflow_parent',
      parentInstanceId,
      parentStepId,
      parentStepInstanceId: stepInstanceId,
      childInstanceId,
      childStatus: 'FAILED',
    })
  })
})

describe('completed child output contract is pinned to the version the child ran on (#7184)', () => {
  const codeChildDefinitionId = codeWorkflowUuid('child-workflow')
  const dbChildDefinitionId = '00000000-0000-4000-8000-000000000009'

  const unpinnedParentDefinition: Partial<WorkflowDefinition> = {
    ...parentDefinition,
    definition: {
      ...parentDefinition.definition!,
      steps: parentDefinition.definition!.steps.map((step) =>
        step.stepId === parentStepId
          ? {
              ...step,
              config: {
                subWorkflowId: 'child-workflow',
                inputMapping: { childOrderId: 'orderId' },
                outputMapping: { parentResult: 'childResult' },
              },
            }
          : step,
      ),
    },
  }

  const childIo = (requiredOutputs: string[]) => ({
    outputs: requiredOutputs.map((name) => ({ name, type: 'text', label: name, required: true })),
  })

  const codeChild = (version: number, requiredOutputs: string[]) => ({
    workflowId: 'child-workflow',
    workflowName: `Child v${version}`,
    version,
    enabled: true,
    moduleId: 'test_module',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [{ transitionId: 'start_to_end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
      io: childIo(requiredOutputs),
    },
  }) as never

  const parkedParent = () => ({
    id: parentInstanceId, definitionId: parentDefinitionId, workflowId: 'parent-workflow', version: 1,
    currentStepId: parentStepId, status: 'PAUSED', context: {}, tenantId, organizationId,
  })

  function makeEm(
    child: Record<string, unknown>,
    definitions: { byId?: Record<string, unknown>; byWorkflowId?: Record<string, unknown> | null } = {},
  ): EntityManager {
    const findOne = jest.fn(async (entity: any, where: any) => {
      const name = typeof entity === 'function' ? entity.name : entity
      if (name === 'WorkflowInstance') {
        if (where?.id === parentInstanceId) return parkedParent()
        if (where?.id === childInstanceId) return child
        return null
      }
      if (name === 'WorkflowDefinition') {
        if (where?.id === parentDefinitionId) return unpinnedParentDefinition
        if (where?.workflowId) return definitions.byWorkflowId ?? null
        if (where?.id && definitions.byId?.[where.id]) return definitions.byId[where.id]
        return null
      }
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

  beforeEach(() => {
    clearCodeWorkflowRegistry()
    mockLoggerInstance.warn.mockClear()
  })

  afterAll(() => {
    clearCodeWorkflowRegistry()
  })

  test('an unpinned code child parked on v1 is validated against v1 after v2 (new required port) becomes latest', async () => {
    registerCodeWorkflows([codeChild(1, ['childResult']), codeChild(2, ['childResult', 'addedInV2'])])
    const completeSpy = jest.spyOn(workflowExecutor, 'completeWorkflow').mockResolvedValue(undefined)
    const em = makeEm({
      id: childInstanceId, definitionId: codeChildDefinitionId, workflowId: 'child-workflow', version: 1,
      context: { childResult: 'from-v1' }, tenantId, organizationId,
    })

    await resumeParentAfterSubWorkflow(em, {} as AwilixContainer, makeResumeJob())

    expect(completeSpy).not.toHaveBeenCalled()
    expect(sendSignalMock).toHaveBeenCalledTimes(1)
    const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { payload: Record<string, unknown> }]
    expect(options.payload).toEqual({ parentResult: 'from-v1' })
    completeSpy.mockRestore()
  })

  test('a child whose version was removed falls back to the latest contract with one warning', async () => {
    registerCodeWorkflows([codeChild(2, ['childResult', 'addedInV2'])])
    const completeSpy = jest.spyOn(workflowExecutor, 'completeWorkflow').mockResolvedValue(undefined)
    const em = makeEm({
      id: childInstanceId, definitionId: codeChildDefinitionId, workflowId: 'child-workflow', version: 1,
      context: { childResult: 'from-v1' }, tenantId, organizationId,
    })
    const container = {} as AwilixContainer

    await resumeParentAfterSubWorkflow(em, container, makeResumeJob())

    expect(sendSignalMock).not.toHaveBeenCalled()
    expect(completeSpy).toHaveBeenCalledWith(em, container, parentInstanceId, 'FAILED', {
      error: 'Sub-workflow output validation failed: Required port "addedInV2" is missing',
    })
    const fallbackWarnings = mockLoggerInstance.warn.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.startsWith('Pinned code workflow version is not registered'),
    )
    expect(fallbackWarnings).toHaveLength(1)
    expect(fallbackWarnings[0][1]).toEqual({ workflowId: 'child-workflow', requestedVersion: 1, resolvedVersion: 2 })
    completeSpy.mockRestore()
  })

  test('a DB-defined child is validated against its own row, not the newest published one', async () => {
    const ownRow = {
      id: dbChildDefinitionId, workflowId: 'child-workflow', version: 1, enabled: true,
      definition: { steps: [], transitions: [], io: childIo(['childResult']) }, tenantId, organizationId,
    }
    const newerRow = {
      ...ownRow, id: '00000000-0000-4000-8000-00000000000a', version: 2,
      definition: { steps: [], transitions: [], io: childIo(['childResult', 'addedInV2']) },
    }
    const completeSpy = jest.spyOn(workflowExecutor, 'completeWorkflow').mockResolvedValue(undefined)
    const em = makeEm(
      {
        id: childInstanceId, definitionId: dbChildDefinitionId, workflowId: 'child-workflow', version: 1,
        context: { childResult: 'from-db-v1' }, tenantId, organizationId,
      },
      { byId: { [dbChildDefinitionId]: ownRow }, byWorkflowId: newerRow },
    )

    await resumeParentAfterSubWorkflow(em, {} as AwilixContainer, makeResumeJob())

    expect(completeSpy).not.toHaveBeenCalled()
    const [, , options] = sendSignalMock.mock.calls[0] as [unknown, unknown, { payload: Record<string, unknown> }]
    expect(options.payload).toEqual({ parentResult: 'from-db-v1' })
    expect((em.findOne as jest.Mock)).toHaveBeenCalledWith(expect.anything(), { id: dbChildDefinitionId })
    completeSpy.mockRestore()
  })
})

describe('SUB_WORKFLOW start-time child selection is unchanged (#7184)', () => {
  const childV1 = {
    workflowId: 'child-workflow',
    workflowName: 'Child v1',
    version: 1,
    enabled: true,
    moduleId: 'test_module',
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [{ transitionId: 'start_to_end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
      io: { inputs: [{ name: 'childOrderId', type: 'text', label: 'Order', required: true }] },
    },
  }
  const childV2 = {
    ...childV1,
    workflowName: 'Child v2',
    version: 2,
    definition: {
      ...childV1.definition,
      io: {
        inputs: [
          { name: 'childOrderId', type: 'text', label: 'Order', required: true },
          { name: 'addedInV2', type: 'text', label: 'Added in v2', required: true },
        ],
      },
    },
  }

  function parentWithChildVersion(version: number | undefined): Partial<WorkflowDefinition> {
    const definition = parentDefinition.definition!
    return {
      ...parentDefinition,
      definition: {
        ...definition,
        steps: definition.steps.map((step) => {
          if (step.stepId !== parentStepId) return step
          const { version: _ignored, ...config } = step.config as Record<string, unknown>
          return { ...step, config: version === undefined ? config : { ...config, version } }
        }),
      },
    }
  }

  function makeEm(parentDef: Partial<WorkflowDefinition>): EntityManager {
    return {
      findOne: jest.fn(async (entity: any, where: any) => {
        const name = typeof entity === 'function' ? entity.name : entity
        if (name === 'WorkflowDefinition') return where?.id === parentDefinitionId ? parentDef : null
        return null
      }),
      create: jest.fn((_entity: any, data: any) => ({ ...data, id: stepInstanceId })),
      persist: jest.fn(function persist(this: any) { return this }),
      flush: jest.fn().mockResolvedValue(undefined),
    } as unknown as EntityManager
  }

  beforeEach(() => {
    clearCodeWorkflowRegistry()
    registerCodeWorkflows([childV1, childV2] as never)
  })

  afterAll(() => {
    clearCodeWorkflowRegistry()
  })

  test('a pinned SUB_WORKFLOW validates and starts the pinned version', async () => {
    const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      .mockResolvedValue({ ...childInstance } as WorkflowInstance)
    const executeWorkflowSpy = jest.spyOn(workflowExecutor, 'executeWorkflow')
      .mockResolvedValue({ status: 'COMPLETED', currentStep: 'end', context: { childResult: 'ok' }, events: [], executionTime: 1 })
    const instance = { ...parentInstance } as WorkflowInstance

    const result = await stepHandler.executeStep(
      makeEm(parentWithChildVersion(1)), instance, parentStepId, { workflowContext: instance.context! }, {} as AwilixContainer,
    )

    expect(result.status).toBe('COMPLETED')
    expect(startWorkflowSpy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workflowId: 'child-workflow', version: 1 }))
    startWorkflowSpy.mockRestore()
    executeWorkflowSpy.mockRestore()
  })

  test('an unpinned SUB_WORKFLOW validates against the latest version', async () => {
    const startWorkflowSpy = jest.spyOn(workflowExecutor, 'startWorkflow')
      .mockResolvedValue({ ...childInstance } as WorkflowInstance)
    const instance = { ...parentInstance } as WorkflowInstance

    const result = await stepHandler.executeStep(
      makeEm(parentWithChildVersion(undefined)), instance, parentStepId, { workflowContext: instance.context! }, {} as AwilixContainer,
    )

    expect(result.status).toBe('FAILED')
    expect(result.error).toContain('addedInV2')
    expect(startWorkflowSpy).not.toHaveBeenCalled()
    startWorkflowSpy.mockRestore()
  })
})
