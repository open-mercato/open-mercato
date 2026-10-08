import type { EntityManager } from '@mikro-orm/core'
import type { EntityManager as PostgreSqlEntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import {
  createCausationEnvelope,
  getAmbientCausation,
  runWithCausation,
  type CausationEnvelope,
} from '@open-mercato/shared/lib/causation/server'
import { WorkflowInstance, type WorkflowDefinition } from '../../data/entities'
import * as workflowExecutor from '../workflow-executor'
import * as activityExecutor from '../activity-executor'
import * as transitionHandler from '../transition-handler'
import { executeRegistryActivity } from '../activity-worker-handler'
import type { ActivityContext, ActivityDefinition } from '../activity-executor'
import {
  clearWorkflowSafeCommandsForTests,
  registerWorkflowSafeCommands,
} from '../workflow-safe-commands'
import { runInWorkflowCausationFrame } from '../workflow-causation'
import * as ruleEngine from '../../../business_rules/lib/rule-engine'

jest.mock('../../../business_rules/lib/rule-engine')

const TENANT_ID = '00000000-0000-4000-8000-000000000001'
const ORG_ID = '00000000-0000-4000-8000-000000000002'
const DEFINITION_ID = '00000000-0000-4000-8000-000000000003'
const INSTANCE_ID = '00000000-0000-4000-8000-000000000004'
const STEP_INSTANCE_ID = '00000000-0000-4000-8000-000000000005'
const USER_ID = '00000000-0000-4000-8000-000000000006'
const AMBIENT_CORRELATION_ID = '00000000-0000-4000-8000-0000000000a1'
const ORIGIN_CORRELATION_ID = '00000000-0000-4000-8000-0000000000b2'
const SPOOFED_CORRELATION_ID = '00000000-0000-4000-8000-0000000000c3'
const WORKFLOW_ID = 'qa-causation-workflow'

const definition: Partial<WorkflowDefinition> = {
  id: DEFINITION_ID,
  workflowId: WORKFLOW_ID,
  workflowName: 'Causation Workflow',
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
        preConditions: [{ ruleId: 'qa-guard-rule', required: true }],
      },
      { transitionId: 'step-2-to-end', fromStepId: 'step-2', toStepId: 'end', trigger: 'auto' },
    ],
  },
  tenantId: TENANT_ID,
  organizationId: ORG_ID,
}

type CreatedEntity = { entity: unknown; data: Record<string, unknown> }

function createEntityManagerMock(definitionRecord: Partial<WorkflowDefinition> = definition) {
  const created: CreatedEntity[] = []
  const mock = {
    findOne: jest.fn(async () => definitionRecord),
    find: jest.fn(async () => []),
    count: jest.fn(async () => 0),
    create: jest.fn((entity: unknown, data: Record<string, unknown>) => {
      created.push({ entity, data })
      return entity === WorkflowInstance ? { id: INSTANCE_ID, ...data } : { ...data }
    }),
    persist: jest.fn(function persist(this: unknown) {
      return this
    }),
    flush: jest.fn(async () => undefined),
  }
  return { em: mock as unknown as EntityManager, created }
}

function createdInstanceMetadata(created: CreatedEntity[]): Record<string, unknown> | undefined {
  const record = created.find((entry) => entry.entity === WorkflowInstance)
  return record?.data.metadata as Record<string, unknown> | undefined
}

function createdStartEventMetadata(created: CreatedEntity[]): Record<string, unknown> | undefined {
  const record = created.find((entry) => entry.data.eventType === 'WORKFLOW_STARTED')
  const eventData = record?.data.eventData as { metadata?: Record<string, unknown> } | undefined
  return eventData?.metadata
}

function buildInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: INSTANCE_ID,
    definitionId: DEFINITION_ID,
    workflowId: WORKFLOW_ID,
    version: 1,
    status: 'RUNNING',
    currentStepId: 'step-1',
    context: { orderId: 'order-123' },
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

const updateEntityActivity: ActivityDefinition = {
  activityId: 'update-order',
  activityName: 'updateOrder',
  activityType: 'UPDATE_ENTITY',
  config: {
    commandId: 'sales.orders.update',
    input: { id: '{{context.orderId}}', externalReference: 'qa-causation' },
  },
}

function createCommandContainer() {
  const observed: Array<CausationEnvelope | null> = []
  const commandBus = {
    execute: jest.fn(async () => {
      observed.push(getAmbientCausation())
      return { result: { ok: true }, logEntry: { id: 'log-1' } }
    }),
  }
  const rbacService = { userHasAllFeatures: jest.fn(async () => true) }
  const container = {
    resolve: jest.fn((name: string) => {
      if (name === 'commandBus') return commandBus
      if (name === 'rbacService') return rbacService
      throw new Error(`[internal] unexpected service ${name}`)
    }),
  }
  return { container: container as unknown as AwilixContainer, commandBus, observed }
}

function buildActivityContext(instance: WorkflowInstance): ActivityContext {
  return {
    workflowInstance: instance,
    workflowContext: instance.context,
    stepInstanceId: STEP_INSTANCE_ID,
    userId: USER_ID,
  }
}

const expectedWorkflowFrame = {
  kind: 'workflow',
  id: INSTANCE_ID,
  ref: STEP_INSTANCE_ID,
  meta: { workflowId: WORKFLOW_ID },
}

describe('workflow causation', () => {
  const originalCausationFlag = process.env.OM_CAUSATION

  beforeEach(() => {
    jest.clearAllMocks()
    clearWorkflowSafeCommandsForTests()
    registerWorkflowSafeCommands([
      { commandId: 'sales.orders.update', requiredFeatures: ['sales.orders.manage'], defaultEnabled: true },
    ])
    delete process.env.OM_CAUSATION
  })

  afterEach(() => {
    if (originalCausationFlag === undefined) delete process.env.OM_CAUSATION
    else process.env.OM_CAUSATION = originalCausationFlag
  })

  describe('startWorkflow origin causation', () => {
    const spoofedCausation = {
      correlationId: SPOOFED_CORRELATION_ID,
      frames: [{ kind: 'business_rule', id: 'spoofed-rule' }],
    }

    test('stores the ambient causation and ignores a client-supplied metadata.causation', async () => {
      const { em, created } = createEntityManagerMock()
      const ambient = createCausationEnvelope([{ kind: 'user' }], { correlationId: AMBIENT_CORRELATION_ID })
      const metadata = { initiatedBy: USER_ID, causation: spoofedCausation } as workflowExecutor.StartWorkflowOptions['metadata']

      await runWithCausation(ambient, () =>
        workflowExecutor.startWorkflow(em, {
          workflowId: WORKFLOW_ID,
          metadata,
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
        }),
      )

      const stored = createdInstanceMetadata(created)
      expect(stored?.initiatedBy).toBe(USER_ID)
      expect(stored?.causation).toEqual({ correlationId: AMBIENT_CORRELATION_ID, frames: [{ kind: 'user' }] })
      expect(createdStartEventMetadata(created)?.causation).toEqual(stored?.causation)
    })

    test('stores the start causation as identifiers only', async () => {
      const { em, created } = createEntityManagerMock()
      const ambient = createCausationEnvelope(
        [
          { kind: 'api_key', id: 'key-1', meta: { viaKeyId: 'key-2' } },
          { kind: 'workflow', id: INSTANCE_ID, ref: STEP_INSTANCE_ID, meta: { workflowId: WORKFLOW_ID } },
          { kind: 'subscriber', id: 'business_rules:crud-rule-trigger', ref: 'customers.person.updated' },
        ],
        { correlationId: AMBIENT_CORRELATION_ID },
      )

      await runWithCausation(ambient, () =>
        workflowExecutor.startWorkflow(em, {
          workflowId: WORKFLOW_ID,
          metadata: { initiatedBy: USER_ID },
          tenantId: TENANT_ID,
          organizationId: ORG_ID,
        }),
      )

      const stored = createdInstanceMetadata(created)?.causation
      expect(stored).toEqual({
        correlationId: AMBIENT_CORRELATION_ID,
        frames: [
          { kind: 'api_key', id: 'key-1' },
          { kind: 'workflow', id: INSTANCE_ID, ref: STEP_INSTANCE_ID },
          { kind: 'subscriber', id: 'business_rules:crud-rule-trigger' },
        ],
      })
      expect(createdStartEventMetadata(created)?.causation).toEqual(stored)
    })

    test('falls back to a user entry frame when a user started the run without ambient causation', async () => {
      const { em, created } = createEntityManagerMock()
      const metadata = { initiatedBy: USER_ID, causation: spoofedCausation } as workflowExecutor.StartWorkflowOptions['metadata']

      await workflowExecutor.startWorkflow(em, {
        workflowId: WORKFLOW_ID,
        metadata,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })

      const causation = createdInstanceMetadata(created)?.causation as CausationEnvelope
      expect(causation.frames).toEqual([{ kind: 'user' }])
      expect(causation.correlationId).not.toBe(SPOOFED_CORRELATION_ID)
    })

    test('falls back to a system entry frame when no user initiated the run', async () => {
      const triggerStart = createEntityManagerMock()
      await workflowExecutor.startWorkflow(triggerStart.em, {
        workflowId: WORKFLOW_ID,
        metadata: { initiatedBy: 'trigger:qa-trigger' },
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })
      const bareStart = createEntityManagerMock()
      await workflowExecutor.startWorkflow(bareStart.em, {
        workflowId: WORKFLOW_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })

      const triggerCausation = createdInstanceMetadata(triggerStart.created)?.causation as CausationEnvelope
      const bareCausation = createdInstanceMetadata(bareStart.created)?.causation as CausationEnvelope
      expect(triggerCausation.frames).toEqual([{ kind: 'system' }])
      expect(bareCausation.frames).toEqual([{ kind: 'system' }])
    })

    test('stores no causation when causation is disabled but still drops a client-supplied one', async () => {
      process.env.OM_CAUSATION = 'false'
      const withMetadata = createEntityManagerMock()
      const metadata = { initiatedBy: USER_ID, causation: spoofedCausation } as workflowExecutor.StartWorkflowOptions['metadata']
      await workflowExecutor.startWorkflow(withMetadata.em, {
        workflowId: WORKFLOW_ID,
        metadata,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })
      const withoutMetadata = createEntityManagerMock()
      await workflowExecutor.startWorkflow(withoutMetadata.em, {
        workflowId: WORKFLOW_ID,
        tenantId: TENANT_ID,
        organizationId: ORG_ID,
      })

      expect(createdInstanceMetadata(withMetadata.created)).toEqual({ initiatedBy: USER_ID })
      expect(createdInstanceMetadata(withoutMetadata.created)).toBeUndefined()
    })
  })

  describe('activity execution frame', () => {
    test('runs UPDATE_ENTITY inside a workflow frame stacked on the ambient trigger', async () => {
      const { em } = createEntityManagerMock()
      const { container, observed } = createCommandContainer()
      const trigger = createCausationEnvelope([{ kind: 'schedule', id: 'schedule-1' }], {
        correlationId: AMBIENT_CORRELATION_ID,
      })

      const result = await runWithCausation(trigger, async () => {
        const executed = await activityExecutor.executeActivity(
          em,
          container,
          updateEntityActivity,
          buildActivityContext(buildInstance()),
        )
        expect(getAmbientCausation()).toEqual(trigger)
        return executed
      })

      expect(result.success).toBe(true)
      expect(observed).toEqual([
        {
          correlationId: AMBIENT_CORRELATION_ID,
          frames: [{ kind: 'schedule', id: 'schedule-1' }, expectedWorkflowFrame],
        },
      ])
    })

    test('resumes without ambient causation under a fresh system entry frame, not the stored origin', async () => {
      const { em } = createEntityManagerMock()
      const { container, observed } = createCommandContainer()

      const result = await activityExecutor.executeActivity(
        em,
        container,
        updateEntityActivity,
        buildActivityContext(buildInstance()),
      )

      expect(result.success).toBe(true)
      expect(observed).toHaveLength(1)
      expect(observed[0]?.frames).toEqual([{ kind: 'system' }, expectedWorkflowFrame])
      expect(observed[0]?.correlationId).not.toBe(ORIGIN_CORRELATION_ID)
      expect(getAmbientCausation()).toBeNull()
    })

    test('stacks the workflow frame for queued activities executed by the worker', async () => {
      const { em } = createEntityManagerMock()
      const { container, observed } = createCommandContainer()
      const restoredJobCausation = createCausationEnvelope([{ kind: 'user' }], {
        correlationId: AMBIENT_CORRELATION_ID,
      })

      await runWithCausation(restoredJobCausation, () =>
        executeRegistryActivity(
          { activityType: 'UPDATE_ENTITY', activityConfig: { ...updateEntityActivity.config, input: { id: 'order-123' } } },
          buildActivityContext(buildInstance()),
          { em: em as unknown as PostgreSqlEntityManager, container },
        ),
      )

      expect(observed).toEqual([
        {
          correlationId: AMBIENT_CORRELATION_ID,
          frames: [{ kind: 'user' }, expectedWorkflowFrame],
        },
      ])
    })

    test('does not stack an identical workflow frame twice', () => {
      const instance = buildInstance()
      const frames = runInWorkflowCausationFrame({ instance, stepInstanceId: STEP_INSTANCE_ID }, () =>
        runInWorkflowCausationFrame({ instance, stepInstanceId: STEP_INSTANCE_ID }, () => getAmbientCausation()?.frames),
      )

      expect(frames).toEqual([{ kind: 'system' }, expectedWorkflowFrame])
    })

    test('runs without a frame when causation is disabled', async () => {
      process.env.OM_CAUSATION = 'false'
      const { em } = createEntityManagerMock()
      const { container, observed } = createCommandContainer()

      const result = await activityExecutor.executeActivity(
        em,
        container,
        updateEntityActivity,
        buildActivityContext(buildInstance()),
      )

      expect(result.success).toBe(true)
      expect(observed).toEqual([null])
    })

    test('keeps a dry run simulated without reaching the command bus', async () => {
      const { em } = createEntityManagerMock()
      const { container, commandBus } = createCommandContainer()

      const result = await activityExecutor.executeActivity(
        em,
        container,
        updateEntityActivity,
        buildActivityContext(buildInstance({ isDryRun: true })),
      )

      expect(result.success).toBe(true)
      expect(result.output).toEqual({ executed: false, simulated: true, commandId: 'sales.orders.update' })
      expect(commandBus.execute).not.toHaveBeenCalled()
      expect(getAmbientCausation()).toBeNull()
    })
  })

  describe('transition guard rules', () => {
    test('evaluates a pre-condition rule inside the workflow frame', async () => {
      const { em } = createEntityManagerMock()
      const { container } = createCommandContainer()
      const observed: Array<CausationEnvelope | null> = []
      ;(ruleEngine.executeRuleByRuleId as jest.Mock).mockImplementation(async () => {
        observed.push(getAmbientCausation())
        return {
          success: true,
          ruleId: 'qa-guard-rule',
          ruleName: 'QA Guard Rule',
          conditionResult: true,
          actionsExecuted: null,
          executionTime: 1,
        }
      })
      const trigger = createCausationEnvelope([{ kind: 'user' }], { correlationId: AMBIENT_CORRELATION_ID })

      await runWithCausation(trigger, () =>
        transitionHandler.executeTransition(em, container, buildInstance(), 'step-1', 'step-2', {
          workflowContext: {},
        }),
      )

      expect(observed).toEqual([
        {
          correlationId: AMBIENT_CORRELATION_ID,
          frames: [{ kind: 'user' }, { kind: 'workflow', id: INSTANCE_ID, meta: { workflowId: WORKFLOW_ID } }],
        },
      ])
    })

    test('evaluates a post-condition rule inside the workflow frame', async () => {
      const postConditionDefinition: Partial<WorkflowDefinition> = {
        ...definition,
        definition: {
          steps: definition.definition!.steps,
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
      }
      const { em } = createEntityManagerMock(postConditionDefinition)
      const { container } = createCommandContainer()
      const observed: Array<{ ruleId: string; causation: CausationEnvelope | null }> = []
      ;(ruleEngine.executeRuleByRuleId as jest.Mock).mockImplementation(async (_em: unknown, options: { ruleId: string }) => {
        observed.push({ ruleId: options.ruleId, causation: getAmbientCausation() })
        return {
          success: true,
          ruleId: options.ruleId,
          ruleName: 'QA Post Guard',
          conditionResult: true,
          actionsExecuted: null,
          executionTime: 1,
        }
      })
      const trigger = createCausationEnvelope([{ kind: 'user' }], { correlationId: AMBIENT_CORRELATION_ID })

      const result = await runWithCausation(trigger, () =>
        transitionHandler.executeTransition(em, container, buildInstance(), 'step-1', 'step-2', {
          workflowContext: {},
        }),
      )

      expect(result.conditionsEvaluated?.postConditions).toBe(true)
      expect(observed).toEqual([
        {
          ruleId: 'qa-post-guard',
          causation: {
            correlationId: AMBIENT_CORRELATION_ID,
            frames: [{ kind: 'user' }, { kind: 'workflow', id: INSTANCE_ID, meta: { workflowId: WORKFLOW_ID } }],
          },
        },
      ])
    })
  })
})
