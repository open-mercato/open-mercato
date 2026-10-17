import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  createCausationEnvelope,
  getAmbientCausation,
  isUuid,
  runWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import { StepInstance, WorkflowInstance, type WorkflowDefinition } from '../../data/entities'
import { BusinessRule, RuleExecutionLog } from '../../../business_rules/data/entities'
import * as ruleEvaluator from '../../../business_rules/lib/rule-evaluator'
import * as actionExecutor from '../../../business_rules/lib/action-executor'
import * as workflowExecutor from '../workflow-executor'
import * as stepHandler from '../step-handler'
import * as transitionHandler from '../transition-handler'
import { runWorkflowErrorHandler } from '../error-handler'
import { runInWorkflowCausationFrame } from '../workflow-causation'
import type { WorkflowActivityJobErrorHandler } from '../activity-queue-types'

jest.mock('../../../business_rules/lib/rule-evaluator')
jest.mock('../../../business_rules/lib/action-executor')

const mockReportCausationDegradation = jest.fn()

jest.mock('@open-mercato/shared/lib/causation/server', () => ({
  ...jest.requireActual<typeof import('@open-mercato/shared/lib/causation/server')>(
    '@open-mercato/shared/lib/causation/server',
  ),
  reportCausationDegradation: (...args: unknown[]) => mockReportCausationDegradation(...args),
}))

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const ORG_ID = '00000000-0000-4000-8000-000000000002'
const PARENT_DEFINITION_ID = '00000000-0000-4000-8000-000000000011'
const CHILD_DEFINITION_ID = '00000000-0000-4000-8000-000000000012'
const HANDLER_DEFINITION_ID = '00000000-0000-4000-8000-000000000013'
const PARENT_INSTANCE_ID = '00000000-0000-4000-8000-000000000021'
const STARTED_INSTANCE_ID = '00000000-0000-4000-8000-000000000022'
const PARENT_STEP_INSTANCE_ID = '00000000-0000-4000-8000-000000000031'
const USER_ID = '00000000-0000-4000-8000-000000000041'
const ORIGIN_CORRELATION_ID = '00000000-0000-4000-8000-0000000000b2'
const TRIGGER_CORRELATION_ID = '00000000-0000-4000-8000-0000000000a1'
const GUARD_DEFINITION_ID = '00000000-0000-4000-8000-000000000014'
const GUARD_RULE_UUID = '00000000-0000-4000-8000-000000000051'

function buildDefinition(
  id: string,
  workflowId: string,
  steps: Array<Record<string, unknown>>,
): Partial<WorkflowDefinition> {
  return {
    id,
    workflowId,
    workflowName: workflowId,
    version: 1,
    enabled: true,
    definition: {
      steps,
      transitions: [{ transitionId: 'start-to-end', fromStepId: 'start', toStepId: 'end', trigger: 'auto' }],
    },
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
  } as Partial<WorkflowDefinition>
}

const parentDefinition = buildDefinition(PARENT_DEFINITION_ID, 'parent-workflow', [
  { stepId: 'start', stepName: 'Start', stepType: 'START' },
  {
    stepId: 'invoke-child',
    stepName: 'Invoke Child',
    stepType: 'SUB_WORKFLOW',
    config: { subWorkflowId: 'child-workflow', version: 1 },
  },
  { stepId: 'end', stepName: 'End', stepType: 'END' },
])

const childDefinition = buildDefinition(CHILD_DEFINITION_ID, 'child-workflow', [
  { stepId: 'start', stepName: 'Start', stepType: 'START' },
  { stepId: 'end', stepName: 'End', stepType: 'END' },
])

const handlerDefinition = buildDefinition(HANDLER_DEFINITION_ID, 'oops-handler', [
  { stepId: 'start', stepName: 'Start', stepType: 'START' },
  { stepId: 'end', stepName: 'End', stepType: 'END' },
])

const guardDefinition: Partial<WorkflowDefinition> = {
  id: GUARD_DEFINITION_ID,
  workflowId: 'post-guard-workflow',
  workflowName: 'post-guard-workflow',
  version: 1,
  enabled: true,
  definition: {
    steps: [
      { stepId: 'start', stepName: 'Start', stepType: 'START' },
      { stepId: 'step-1', stepName: 'Step 1', stepType: 'AUTOMATED' },
      { stepId: 'step-2', stepName: 'Step 2', stepType: 'AUTOMATED' },
      { stepId: 'end', stepName: 'End', stepType: 'END' },
    ],
    transitions: [
      { transitionId: 'start-to-step-1', fromStepId: 'start', toStepId: 'step-1', trigger: 'auto' },
      {
        transitionId: 'step-1-to-step-2',
        fromStepId: 'step-1',
        toStepId: 'step-2',
        trigger: 'auto',
        postConditions: [{ ruleId: 'qa-post-guard', required: true }],
      },
      { transitionId: 'step-2-to-end', fromStepId: 'step-2', toStepId: 'end', trigger: 'auto' },
    ],
  },
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
} as Partial<WorkflowDefinition>

const guardRule = {
  id: GUARD_RULE_UUID,
  ruleId: 'qa-post-guard',
  ruleName: 'QA Post Guard',
  ruleType: 'GUARD',
  entityType: 'workflow:post-guard-workflow:transition',
  eventType: 'post_transition',
  conditionExpression: { field: 'workflowId', operator: '=', value: 'post-guard-workflow' },
  successActions: [{ type: 'LOG', config: { message: 'post guard passed' } }],
  failureActions: null,
  enabled: true,
  priority: 100,
  version: 1,
  effectiveFrom: null,
  effectiveTo: null,
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
} as unknown as BusinessRule

const definitions = [parentDefinition, childDefinition, handlerDefinition, guardDefinition]

function buildParentInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: PARENT_INSTANCE_ID,
    definitionId: PARENT_DEFINITION_ID,
    workflowId: 'parent-workflow',
    version: 1,
    status: 'RUNNING',
    currentStepId: 'invoke-child',
    context: { orderId: 'order-1' },
    metadata: {
      initiatedBy: USER_ID,
      causation: createCausationEnvelope([{ kind: 'user' }], { correlationId: ORIGIN_CORRELATION_ID }),
    },
    startedAt: new Date(),
    retryCount: 0,
    isDryRun: false,
    tenantId: TENANT_ID,
    organizationId: ORG_ID,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as WorkflowInstance
}

type CreatedEntity = { entity: unknown; data: Record<string, unknown> }

function createEntityManagerMock(instances: WorkflowInstance[]) {
  const created: CreatedEntity[] = []
  const mock = {
    findOne: jest.fn(async (entity: unknown, where: Record<string, unknown>) => {
      if (entity === WorkflowInstance) return instances.find((instance) => instance.id === where.id) ?? null
      if (entity === StepInstance) return null
      if (entity === BusinessRule) return where.ruleId === guardRule.ruleId ? guardRule : null
      return (
        definitions.find(
          (definition) => definition.id === where.id || definition.workflowId === where.workflowId,
        ) ?? null
      )
    }),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      created.push({ entity, data })
      if (entity === WorkflowInstance) return { id: STARTED_INSTANCE_ID, ...data }
      if (entity === StepInstance) return { id: PARENT_STEP_INSTANCE_ID, ...data }
      return { ...data }
    }),
    persist: jest.fn(function persist(this: unknown) {
      return this
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em: mock as unknown as EntityManager, created }
}

function storedStartCausation(created: CreatedEntity[]): CausationEnvelope | undefined {
  const record = created.find((entry) => entry.entity === WorkflowInstance)
  const metadata = record?.data.metadata as { causation?: CausationEnvelope } | undefined
  return metadata?.causation
}

function innermost(envelope: CausationEnvelope | null | undefined) {
  return envelope ? envelope.frames[envelope.frames.length - 1] : null
}

const container = { resolve: jest.fn() } as unknown as AwilixContainer

describe('workflow causation frames in engine handlers', () => {
  const originalCausationFlag = process.env.OM_CAUSATION
  let observedExecuteCausation: Array<CausationEnvelope | null>

  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env.OM_CAUSATION
    observedExecuteCausation = []
    jest.spyOn(workflowExecutor, 'executeWorkflow').mockImplementation(async () => {
      observedExecuteCausation.push(getAmbientCausation())
      return { status: 'COMPLETED', currentStep: 'end', context: {}, events: [], executionTime: 0 } as never
    })
  })

  afterEach(() => {
    jest.restoreAllMocks()
    if (originalCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = originalCausationFlag
  })

  describe('SUB_WORKFLOW step', () => {
    const parentFrame = {
      kind: 'workflow',
      id: PARENT_INSTANCE_ID,
      ref: PARENT_STEP_INSTANCE_ID,
      meta: { workflowId: 'parent-workflow' },
    }

    async function runSubWorkflowStep(): Promise<{ created: CreatedEntity[]; status: string }> {
      const parent = buildParentInstance()
      const { em, created } = createEntityManagerMock([parent])
      const result = await stepHandler.executeStep(
        em,
        parent,
        'invoke-child',
        { workflowContext: parent.context, userId: USER_ID },
        container,
      )
      return { created, status: result.status }
    }

    test('stores the parent workflow frame as the innermost frame of the child start causation', async () => {
      const { created, status } = await runSubWorkflowStep()

      expect(status).toBe('COMPLETED')
      const causation = storedStartCausation(created)
      expect(innermost(causation)).toEqual({
        kind: 'workflow',
        id: PARENT_INSTANCE_ID,
        ref: PARENT_STEP_INSTANCE_ID,
      })
      expect(causation?.frames).toEqual([
        { kind: 'system' },
        { kind: 'workflow', id: PARENT_INSTANCE_ID, ref: PARENT_STEP_INSTANCE_ID },
      ])
      expect(causation?.correlationId).not.toBe(ORIGIN_CORRELATION_ID)
    })

    test('keeps the trigger correlation and stacks the parent frame on it', async () => {
      const trigger = createCausationEnvelope([{ kind: 'user' }], { correlationId: TRIGGER_CORRELATION_ID })

      const { created } = await runWithCausation(trigger, () => runSubWorkflowStep())

      expect(storedStartCausation(created)).toEqual({
        correlationId: TRIGGER_CORRELATION_ID,
        frames: [{ kind: 'user' }, { kind: 'workflow', id: PARENT_INSTANCE_ID, ref: PARENT_STEP_INSTANCE_ID }],
      })
    })

    test('executes the child run inside the parent workflow frame', async () => {
      const trigger = createCausationEnvelope([{ kind: 'user' }], { correlationId: TRIGGER_CORRELATION_ID })

      await runWithCausation(trigger, async () => {
        await runSubWorkflowStep()
        expect(getAmbientCausation()).toEqual(trigger)
      })

      expect(observedExecuteCausation).toEqual([
        { correlationId: TRIGGER_CORRELATION_ID, frames: [{ kind: 'user' }, parentFrame] },
      ])
    })

    test('stores no causation and opens no frame when causation is disabled', async () => {
      process.env.OM_CAUSATION = 'off'

      const { created } = await runSubWorkflowStep()

      const record = created.find((entry) => entry.entity === WorkflowInstance)
      expect(record?.data.metadata).not.toHaveProperty('causation')
      expect(observedExecuteCausation).toEqual([null])
    })
  })

  describe('workflow-level error handler run', () => {
    const failedInstanceId = PARENT_INSTANCE_ID

    function buildPayload(): WorkflowActivityJobErrorHandler {
      return {
        kind: 'workflow_error_handler',
        workflowInstanceId: failedInstanceId,
        handlerWorkflowId: 'oops-handler',
        failedStepId: 'invoke-child',
        error: 'boom',
        contextSnapshot: { orderId: 'order-1' },
        depth: 1,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      }
    }

    async function runHandler(): Promise<{ created: CreatedEntity[]; startedId: string | null }> {
      const failed = buildParentInstance({ status: 'FAILED' })
      const { em, created } = createEntityManagerMock([failed])
      const startedId = await runWorkflowErrorHandler(em, container, buildPayload())
      return { created, startedId }
    }

    test('starts the handler with the failed instance frame as its innermost stored cause', async () => {
      const { created, startedId } = await runHandler()

      expect(startedId).toBe(STARTED_INSTANCE_ID)
      const causation = storedStartCausation(created)
      expect(innermost(causation)).toEqual({ kind: 'workflow', id: failedInstanceId })
      expect(causation?.frames).toEqual([{ kind: 'system' }, { kind: 'workflow', id: failedInstanceId }])
    })

    test('executes the handler run inside a workflow frame of the failed instance', async () => {
      const restoredJobCausation = createCausationEnvelope([{ kind: 'user' }], {
        correlationId: TRIGGER_CORRELATION_ID,
      })

      await runWithCausation(restoredJobCausation, async () => {
        await runHandler()
        expect(getAmbientCausation()).toEqual(restoredJobCausation)
      })

      expect(observedExecuteCausation).toEqual([
        {
          correlationId: TRIGGER_CORRELATION_ID,
          frames: [{ kind: 'user' }, { kind: 'workflow', id: failedInstanceId, meta: { workflowId: 'parent-workflow' } }],
        },
      ])
    })

    test('runs the handler without a frame when causation is disabled', async () => {
      process.env.OM_CAUSATION = 'off'

      const { created } = await runHandler()

      const record = created.find((entry) => entry.entity === WorkflowInstance)
      expect(record?.data.metadata).not.toHaveProperty('causation')
      expect(observedExecuteCausation).toEqual([null])
    })
  })

  describe('transition post-condition guard rule', () => {
    function buildGuardedInstance(): WorkflowInstance {
      return buildParentInstance({
        definitionId: GUARD_DEFINITION_ID,
        workflowId: 'post-guard-workflow',
        currentStepId: 'step-1',
        context: {},
      })
    }

    test('runs the guard rule actions in a business_rule frame stacked on the workflow frame', async () => {
      const instance = buildGuardedInstance()
      const { em, created } = createEntityManagerMock([instance])
      const observedActionCausation: Array<CausationEnvelope | null> = []
      jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
        rule: guardRule,
        conditionsPassed: true,
        evaluationCompleted: true,
        evaluationTime: 1,
      })
      jest.mocked(actionExecutor.executeActions).mockImplementation(async () => {
        observedActionCausation.push(getAmbientCausation())
        return { success: true, results: [{ action: { type: 'LOG' }, success: true, executionTime: 1 }], totalTime: 1 }
      })
      const trigger = createCausationEnvelope([{ kind: 'user' }], { correlationId: TRIGGER_CORRELATION_ID })

      const result = await runWithCausation(trigger, () =>
        transitionHandler.executeTransition(em, container, instance, 'step-1', 'step-2', { workflowContext: {} }),
      )

      expect(result.success).toBe(true)
      expect(result.conditionsEvaluated?.postConditions).toBe(true)
      expect(actionExecutor.executeActions).toHaveBeenCalledWith(guardRule.successActions, expect.any(Object))
      expect(observedActionCausation).toHaveLength(1)
      const actionCausation = observedActionCausation[0]
      expect(actionCausation?.correlationId).toBe(TRIGGER_CORRELATION_ID)
      const ruleFrame = innermost(actionCausation)
      expect(ruleFrame?.kind).toBe('business_rule')
      expect(ruleFrame?.id).toBe(GUARD_RULE_UUID)
      expect(isUuid(ruleFrame?.ref)).toBe(true)
      expect(actionCausation?.frames).toEqual([
        { kind: 'user' },
        { kind: 'workflow', id: PARENT_INSTANCE_ID, meta: { workflowId: 'post-guard-workflow' } },
        { kind: 'business_rule', id: GUARD_RULE_UUID, ref: ruleFrame?.ref },
      ])

      const logRow = created.find((entry) => entry.entity === RuleExecutionLog)?.data
      expect(logRow?.runId).toBe(ruleFrame?.ref)
      expect(logRow?.entityId).toBe('step-1-to-step-2')
      expect(logRow?.causationJson).toEqual({
        correlationId: TRIGGER_CORRELATION_ID,
        frames: [{ kind: 'user' }, { kind: 'workflow', id: PARENT_INSTANCE_ID }],
      })
    })
  })

  describe('workflow frame without an instance id', () => {
    test('reports the degradation and runs the callback without a frame', () => {
      const result = runInWorkflowCausationFrame({ instance: { id: null } }, () => getAmbientCausation())

      expect(result).toBeNull()
      expect(mockReportCausationDegradation).toHaveBeenCalledWith('workflow_frame_no_instance', {})
    })

    test('keeps the ambient envelope untouched when the instance is missing', () => {
      const ambient = createCausationEnvelope([{ kind: 'user' }], { correlationId: TRIGGER_CORRELATION_ID })

      const seen = runWithCausation(ambient, () =>
        runInWorkflowCausationFrame({ instance: undefined }, () => getAmbientCausation()),
      )

      expect(seen).toEqual(ambient)
      expect(mockReportCausationDegradation).toHaveBeenCalledTimes(1)
    })

    test('does not report a degradation when causation is disabled', () => {
      process.env.OM_CAUSATION = 'off'

      runInWorkflowCausationFrame({ instance: { id: null } }, () => undefined)

      expect(mockReportCausationDegradation).not.toHaveBeenCalled()
    })

    test('does not report a degradation when the instance has an id', () => {
      runInWorkflowCausationFrame({ instance: { id: PARENT_INSTANCE_ID } }, () => undefined)

      expect(mockReportCausationDegradation).not.toHaveBeenCalled()
    })
  })
})
