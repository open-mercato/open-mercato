/**
 * WAIT_FOR_CONDITION tests
 *
 * Covers the step-entry evaluation (`handleWaitForConditionStep` via
 * `executeStep`), the polled backstop (`evaluateWaitCondition`) and the
 * event-driven wake (`wakeConditionWaiters`).
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

jest.mock('../event-logger', () => ({
  logWorkflowEvent: jest.fn(),
  logWorkflowEvents: jest.fn(),
}))

jest.mock('../parallel-handler', () => ({
  resumeBranch: jest.fn(),
}))

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { logWorkflowEvent } from '../event-logger'
import { resumeBranch } from '../parallel-handler'
import * as stepHandler from '../step-handler'
import {
  ConditionWaitError,
  DEFAULT_MAX_CONDITION_ATTEMPTS,
  evaluateWaitCondition,
  readWaitForConditionConfig,
  resolveMaxConditionAttempts,
  wakeConditionWaiters,
} from '../condition-handler'
import { enqueueConditionCheckJob } from '../activity-executor'
import type { WorkflowDefinition, WorkflowInstance, StepInstance } from '../../data/entities'

jest.mock('../activity-executor', () => {
  const actual = jest.requireActual('../activity-executor') as Record<string, unknown>
  return {
    ...actual,
    enqueueConditionCheckJob: jest.fn(),
  }
})

const mockEnqueueConditionCheckJob = enqueueConditionCheckJob as jest.MockedFunction<
  typeof enqueueConditionCheckJob
>
const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>
const mockLogWorkflowEvent = logWorkflowEvent as jest.MockedFunction<typeof logWorkflowEvent>
const mockResumeBranch = resumeBranch as jest.MockedFunction<typeof resumeBranch>

const tenantId = '00000000-0000-4000-8000-000000000001'
const organizationId = '00000000-0000-4000-8000-000000000002'
const definitionId = '00000000-0000-4000-8000-000000000003'
const instanceId = '00000000-0000-4000-8000-000000000004'
const stepInstanceId = '00000000-0000-4000-8000-000000000005'
const branchInstanceId = '00000000-0000-4000-8000-000000000006'

const paymentCapturedCondition = {
  operator: 'AND',
  rules: [{ field: 'payment.status', operator: '==', value: 'captured' }],
}

function makeDefinition(config: Record<string, unknown>): WorkflowDefinition {
  return {
    id: definitionId,
    workflowId: 'condition-workflow',
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'wait_for_payment',
          stepName: 'Wait for payment',
          stepType: 'WAIT_FOR_CONDITION',
          config,
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't1', fromStepId: 'wait_for_payment', toStepId: 'end', trigger: 'auto' },
      ],
    },
    tenantId,
    organizationId,
  } as unknown as WorkflowDefinition
}

function makeInstance(overrides: Partial<WorkflowInstance> = {}): WorkflowInstance {
  return {
    id: instanceId,
    definitionId,
    workflowId: 'condition-workflow',
    version: 1,
    status: 'RUNNING',
    currentStepId: 'wait_for_payment',
    context: {},
    tenantId,
    organizationId,
    startedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    retryCount: 0,
    ...overrides,
  } as unknown as WorkflowInstance
}

function makeStepInstance(overrides: Partial<StepInstance> = {}): StepInstance {
  return {
    id: stepInstanceId,
    workflowInstanceId: instanceId,
    branchInstanceId: null,
    stepId: 'wait_for_payment',
    stepName: 'Wait for payment',
    stepType: 'WAIT_FOR_CONDITION',
    status: 'ACTIVE',
    enteredAt: new Date(Date.now() - 1000),
    tenantId,
    organizationId,
    ...overrides,
  } as unknown as StepInstance
}

describe('WAIT_FOR_CONDITION', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockExitStep: jest.Mock
  let mockFindValidTransitions: jest.Mock
  let mockExecuteTransition: jest.Mock
  let mockExecuteWorkflow: jest.Mock
  let mockCompleteWorkflow: jest.Mock
  let mockContainer: any

  beforeEach(() => {
    jest.clearAllMocks()

    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persist: jest.fn(function persist(this: any) {
        return this
      }),
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
    } as any

    mockExitStep = jest.fn().mockResolvedValue(undefined)
    mockFindValidTransitions = jest.fn().mockResolvedValue([
      { transition: { fromStepId: 'wait_for_payment', toStepId: 'end', trigger: 'auto' }, isValid: true },
    ])
    mockExecuteTransition = jest.fn().mockResolvedValue({ success: true })
    mockExecuteWorkflow = jest.fn().mockResolvedValue({})
    mockCompleteWorkflow = jest.fn().mockResolvedValue(undefined)

    mockContainer = {
      resolve: jest.fn((token: string) => {
        switch (token) {
          case 'eventLogger':
            return { logWorkflowEvent: mockLogWorkflowEvent }
          case 'stepHandler':
            return { exitStep: mockExitStep }
          case 'transitionHandler':
            return {
              findValidTransitions: mockFindValidTransitions,
              executeTransition: mockExecuteTransition,
            }
          case 'workflowExecutor':
            return { executeWorkflow: mockExecuteWorkflow, completeWorkflow: mockCompleteWorkflow }
          default:
            throw new Error(`Unexpected DI token in test: ${token}`)
        }
      }),
    }

    mockLogWorkflowEvent.mockResolvedValue({} as any)
    mockEnqueueConditionCheckJob.mockResolvedValue('condition-job-1' as any)
    mockResumeBranch.mockResolvedValue(true)
  })

  describe('readWaitForConditionConfig', () => {
    test('rejects a missing condition', () => {
      expect(() => readWaitForConditionConfig({ stepId: 'wait', config: { timeout: 'PT30M' } })).toThrow(
        ConditionWaitError
      )
    })

    test('rejects a missing timeout', () => {
      expect(() =>
        readWaitForConditionConfig({ stepId: 'wait', config: { condition: paymentCapturedCondition } })
      ).toThrow(/timeout/i)
    })

    test('clamps the poll interval into its supported range and under the timeout', () => {
      const belowFloor = readWaitForConditionConfig({
        config: { condition: paymentCapturedCondition, timeout: 'PT30M', pollIntervalMs: 10 },
      })
      expect(belowFloor.pollIntervalMs).toBe(5000)

      const aboveTimeout = readWaitForConditionConfig({
        config: { condition: paymentCapturedCondition, timeout: 'PT10S', pollIntervalMs: 600000 },
      })
      expect(aboveTimeout.pollIntervalMs).toBe(10000)
    })

    test('defaults onTimeout to FAIL and the poll interval to 30s', () => {
      const config = readWaitForConditionConfig({
        config: { condition: paymentCapturedCondition, timeout: 'PT30M' },
      })
      expect(config.onTimeout).toBe('FAIL')
      expect(config.pollIntervalMs).toBe(30000)
    })
  })

  describe('resolveMaxConditionAttempts', () => {
    const original = process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS

    afterEach(() => {
      if (original === undefined) delete process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS
      else process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS = original
    })

    test('defaults to 1000 and honours a positive override', () => {
      delete process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS
      expect(resolveMaxConditionAttempts()).toBe(DEFAULT_MAX_CONDITION_ATTEMPTS)

      process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS = '7'
      expect(resolveMaxConditionAttempts()).toBe(7)

      process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS = 'not-a-number'
      expect(resolveMaxConditionAttempts()).toBe(DEFAULT_MAX_CONDITION_ATTEMPTS)
    })
  })

  describe('step entry (handleWaitForConditionStep via executeStep)', () => {
    test('completes immediately without enqueueing a job when the condition already holds', async () => {
      const definition = makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M' })
      const instance = makeInstance({ context: { payment: { status: 'captured' } } } as any)
      mockEm.findOne.mockResolvedValue(definition as any)
      mockEm.create.mockReturnValue(makeStepInstance() as any)

      const result = await stepHandler.executeStep(mockEm, instance, 'wait_for_payment', {
        workflowContext: { payment: { status: 'captured' } },
      })

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData?.conditionMet).toBe(true)
      expect(result.outputData?.wokenBy).toBe('immediate')
      expect(mockEnqueueConditionCheckJob).not.toHaveBeenCalled()
      expect(instance.status).toBe('RUNNING')
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({ eventType: 'CONDITION_MET' })
      )
    })

    test('pauses, logs CONDITION_AWAITING and enqueues a poll job with an absolute deadline', async () => {
      const definition = makeDefinition({
        condition: paymentCapturedCondition,
        timeout: 'PT30M',
        pollIntervalMs: 60000,
      })
      const instance = makeInstance({ context: { payment: { status: 'pending' } } } as any)
      mockEm.findOne.mockResolvedValue(definition as any)
      mockEm.create.mockReturnValue(makeStepInstance() as any)

      const before = Date.now()
      const result = await stepHandler.executeStep(mockEm, instance, 'wait_for_payment', {
        workflowContext: { payment: { status: 'pending' } },
        userId: 'user-1',
      })
      const after = Date.now()

      expect(result.status).toBe('WAITING')
      expect(result.waitReason).toBe('CONDITION')
      expect(instance.status).toBe('PAUSED')

      expect(mockEnqueueConditionCheckJob).toHaveBeenCalledTimes(1)
      const enqueued = mockEnqueueConditionCheckJob.mock.calls[0][0]
      expect(enqueued.attempt).toBe(1)
      expect(enqueued.delayMs).toBe(60000)
      const deadlineMs = Date.parse(enqueued.deadlineAt)
      expect(deadlineMs).toBeGreaterThanOrEqual(before + 30 * 60 * 1000)
      expect(deadlineMs).toBeLessThanOrEqual(after + 30 * 60 * 1000)

      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'CONDITION_AWAITING',
          eventData: expect.objectContaining({ stepId: 'wait_for_payment', pollIntervalMs: 60000 }),
        })
      )
    })

    test('fails the step when the condition config is incomplete', async () => {
      const definition = makeDefinition({ condition: paymentCapturedCondition })
      const instance = makeInstance()
      mockEm.findOne.mockResolvedValue(definition as any)
      mockEm.create.mockReturnValue(makeStepInstance() as any)

      const result = await stepHandler.executeStep(mockEm, instance, 'wait_for_payment', {
        workflowContext: {},
      })

      expect(result.status).toBe('FAILED')
      expect(result.error).toMatch(/timeout/i)
      expect(mockEnqueueConditionCheckJob).not.toHaveBeenCalled()
    })

    test('pauses only the branch and evaluates the branch namespace overlay', async () => {
      const definition = makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M' })
      const instance = makeInstance({ status: 'FORKED', context: { payment: { status: 'pending' } } } as any)
      const branch: any = {
        id: branchInstanceId,
        workflowInstanceId: instanceId,
        currentStepId: 'wait_for_payment',
        contextNamespace: { payment: { status: 'pending' } },
        status: 'ACTIVE',
        tenantId,
        organizationId,
      }
      mockEm.findOne.mockResolvedValue(definition as any)
      mockEm.create.mockReturnValue(makeStepInstance({ branchInstanceId } as any) as any)

      const result = await stepHandler.executeStep(
        mockEm,
        instance,
        'wait_for_payment',
        { workflowContext: { payment: { status: 'pending' } } },
        undefined,
        branch
      )

      expect(result.status).toBe('WAITING')
      expect(branch.status).toBe('PAUSED')
      expect(instance.status).toBe('FORKED')
      expect(mockEnqueueConditionCheckJob.mock.calls[0][0].branchInstanceId).toBe(branchInstanceId)
    })
  })

  describe('evaluateWaitCondition (poll backstop)', () => {
    const futureDeadline = () => new Date(Date.now() + 20 * 60 * 1000).toISOString()

    function primeLookups(
      instance: WorkflowInstance,
      stepInstance: StepInstance | null,
      definition: WorkflowDefinition | null
    ) {
      mockFindOneWithDecryption
        .mockResolvedValueOnce(instance as any)
        .mockResolvedValueOnce(stepInstance as any)
        .mockResolvedValueOnce(definition as any)
    }

    test('re-enqueues at min(pollInterval, remaining) without extending the deadline', async () => {
      const deadlineAt = new Date(Date.now() + 20_000).toISOString()
      const definition = makeDefinition({
        condition: paymentCapturedCondition,
        timeout: 'PT30M',
        pollIntervalMs: 60000,
      })
      primeLookups(
        makeInstance({ status: 'PAUSED', context: { payment: { status: 'pending' } } } as any),
        makeStepInstance(),
        definition
      )

      const result = await evaluateWaitCondition(mockEm, mockContainer, {
        instanceId,
        stepInstanceId,
        deadlineAt,
        attempt: 3,
        tenantId,
        organizationId,
      })

      expect(result.outcome).toBe('pending')
      const enqueued = mockEnqueueConditionCheckJob.mock.calls[0][0]
      expect(enqueued.deadlineAt).toBe(deadlineAt)
      expect(enqueued.attempt).toBe(4)
      expect(enqueued.delayMs).toBeLessThanOrEqual(20_000)
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'CONDITION_EVALUATED',
          eventData: expect.objectContaining({ met: false, attempt: 3 }),
        })
      )
    })

    test('exits the step and runs the auto transition when the condition became true', async () => {
      primeLookups(
        makeInstance({ status: 'PAUSED', context: { payment: { status: 'captured' } } } as any),
        makeStepInstance(),
        makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M' })
      )

      const result = await evaluateWaitCondition(mockEm, mockContainer, {
        instanceId,
        stepInstanceId,
        deadlineAt: futureDeadline(),
        attempt: 2,
        tenantId,
        organizationId,
      })

      expect(result.outcome).toBe('met')
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'CONDITION_MET',
          eventData: expect.objectContaining({ wokenBy: 'poll', attempts: 2 }),
        })
      )
      expect(mockExitStep).toHaveBeenCalled()
      expect(mockExecuteTransition).toHaveBeenCalledWith(
        mockEm,
        mockContainer,
        expect.objectContaining({ id: instanceId }),
        'wait_for_payment',
        'end',
        expect.any(Object)
      )
      expect(mockExecuteWorkflow).toHaveBeenCalled()
      expect(mockEnqueueConditionCheckJob).not.toHaveBeenCalled()
    })

    test('fails the workflow when the deadline passed and onTimeout is FAIL', async () => {
      const stepInstance = makeStepInstance()
      primeLookups(
        makeInstance({ status: 'PAUSED', context: { payment: { status: 'pending' } } } as any),
        stepInstance,
        makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M', onTimeout: 'FAIL' })
      )

      const result = await evaluateWaitCondition(mockEm, mockContainer, {
        instanceId,
        stepInstanceId,
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        attempt: 5,
        tenantId,
        organizationId,
      })

      expect(result.outcome).toBe('timed_out')
      expect(stepInstance.status).toBe('FAILED')
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({ eventType: 'CONDITION_TIMED_OUT' })
      )
      expect(mockCompleteWorkflow).toHaveBeenCalledWith(
        mockEm,
        mockContainer,
        instanceId,
        'FAILED',
        expect.objectContaining({ error: expect.stringContaining('timed out') })
      )
      expect(mockEnqueueConditionCheckJob).not.toHaveBeenCalled()
    })

    test('continues with outputData.timedOut when onTimeout is CONTINUE', async () => {
      primeLookups(
        makeInstance({ status: 'PAUSED', context: { payment: { status: 'pending' } } } as any),
        makeStepInstance(),
        makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M', onTimeout: 'CONTINUE' })
      )

      const result = await evaluateWaitCondition(mockEm, mockContainer, {
        instanceId,
        stepInstanceId,
        deadlineAt: new Date(Date.now() - 1000).toISOString(),
        attempt: 4,
        tenantId,
        organizationId,
      })

      expect(result.outcome).toBe('timed_out')
      expect(mockCompleteWorkflow).not.toHaveBeenCalled()
      expect(mockExitStep).toHaveBeenCalledWith(
        mockEm,
        expect.anything(),
        expect.objectContaining({ timedOut: true, conditionMet: false })
      )
    })

    test('forces a timeout when the attempt cap is reached before the deadline', async () => {
      process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS = '3'
      try {
        primeLookups(
          makeInstance({ status: 'PAUSED', context: { payment: { status: 'pending' } } } as any),
          makeStepInstance(),
          makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M', onTimeout: 'CONTINUE' })
        )

        const result = await evaluateWaitCondition(mockEm, mockContainer, {
          instanceId,
          stepInstanceId,
          deadlineAt: futureDeadline(),
          attempt: 3,
          tenantId,
          organizationId,
        })

        expect(result.outcome).toBe('timed_out')
        expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
          mockEm,
          expect.objectContaining({
            eventType: 'CONDITION_TIMED_OUT',
            eventData: expect.objectContaining({ attemptCapReached: true }),
          })
        )
        expect(mockEnqueueConditionCheckJob).not.toHaveBeenCalled()
      } finally {
        delete process.env.OM_WORKFLOWS_MAX_CONDITION_ATTEMPTS
      }
    })

    test('is a no-op when the event-driven path already resumed the instance', async () => {
      primeLookups(
        makeInstance({ status: 'RUNNING' } as any),
        makeStepInstance({ status: 'COMPLETED' } as any),
        makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M' })
      )

      const result = await evaluateWaitCondition(mockEm, mockContainer, {
        instanceId,
        stepInstanceId,
        deadlineAt: futureDeadline(),
        attempt: 2,
        tenantId,
        organizationId,
      })

      expect(result.outcome).toBe('noop')
      expect(mockExitStep).not.toHaveBeenCalled()
      expect(mockCompleteWorkflow).not.toHaveBeenCalled()
      expect(mockEnqueueConditionCheckJob).not.toHaveBeenCalled()
    })

    test('is a no-op when the instance belongs to another tenant', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(null as any)

      const result = await evaluateWaitCondition(mockEm, mockContainer, {
        instanceId,
        stepInstanceId,
        deadlineAt: futureDeadline(),
        attempt: 1,
        tenantId,
        organizationId,
      })

      expect(result.outcome).toBe('noop')
      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
        mockEm,
        expect.anything(),
        expect.objectContaining({ id: instanceId, tenantId, organizationId }),
        undefined,
        expect.objectContaining({ tenantId, organizationId })
      )
    })

    test('resumes only the owning branch through resumeBranch', async () => {
      const branch: any = {
        id: branchInstanceId,
        workflowInstanceId: instanceId,
        status: 'PAUSED',
        contextNamespace: { payment: { status: 'captured' } },
        tenantId,
        organizationId,
      }
      mockEm.findOne.mockResolvedValue(branch)
      primeLookups(
        makeInstance({ status: 'FORKED', context: {} } as any),
        makeStepInstance({ branchInstanceId } as any),
        makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M' })
      )

      const result = await evaluateWaitCondition(mockEm, mockContainer, {
        instanceId,
        stepInstanceId,
        branchInstanceId,
        deadlineAt: futureDeadline(),
        attempt: 1,
        tenantId,
        organizationId,
      })

      expect(result.outcome).toBe('met')
      expect(mockResumeBranch).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({ instanceId, branchInstanceId, exitStepInstanceId: stepInstanceId })
      )
      expect(mockExitStep).not.toHaveBeenCalled()
      expect(mockExecuteWorkflow).toHaveBeenCalled()
    })
  })

  describe('wakeConditionWaiters (event-driven wake)', () => {
    test('resumes the waiters whose predicate now holds and reports their step ids', async () => {
      const instance = makeInstance({ status: 'PAUSED', context: { payment: { status: 'captured' } } } as any)
      mockFindOneWithDecryption
        .mockResolvedValueOnce(instance as any)
        .mockResolvedValueOnce(makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M' }) as any)
      mockFindWithDecryption.mockResolvedValueOnce([makeStepInstance()] as any)

      const result = await wakeConditionWaiters(mockEm, mockContainer, {
        instanceId,
        tenantId,
        organizationId,
        userId: 'user-1',
      })

      expect(result.woken).toEqual(['wait_for_payment'])
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'CONDITION_MET',
          eventData: expect.objectContaining({ wokenBy: 'context-write' }),
        })
      )
      expect(mockExitStep).toHaveBeenCalled()
    })

    test('logs nothing and wakes nothing when the predicate is still false', async () => {
      const instance = makeInstance({ status: 'PAUSED', context: { payment: { status: 'pending' } } } as any)
      mockFindOneWithDecryption
        .mockResolvedValueOnce(instance as any)
        .mockResolvedValueOnce(makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M' }) as any)
      mockFindWithDecryption.mockResolvedValueOnce([makeStepInstance()] as any)

      const result = await wakeConditionWaiters(mockEm, mockContainer, {
        instanceId,
        tenantId,
        organizationId,
      })

      expect(result.woken).toEqual([])
      expect(mockLogWorkflowEvent).not.toHaveBeenCalled()
      expect(mockExitStep).not.toHaveBeenCalled()
    })

    test('returns no waiters for a terminal instance', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(makeInstance({ status: 'COMPLETED' } as any) as any)

      const result = await wakeConditionWaiters(mockEm, mockContainer, {
        instanceId,
        tenantId,
        organizationId,
      })

      expect(result.woken).toEqual([])
      expect(mockFindWithDecryption).not.toHaveBeenCalled()
    })

    test('scopes the waiter lookup by tenant and organization', async () => {
      mockFindOneWithDecryption
        .mockResolvedValueOnce(makeInstance({ status: 'PAUSED' } as any) as any)
        .mockResolvedValueOnce(makeDefinition({ condition: paymentCapturedCondition, timeout: 'PT30M' }) as any)
      mockFindWithDecryption.mockResolvedValueOnce([] as any)

      await wakeConditionWaiters(mockEm, mockContainer, { instanceId, tenantId, organizationId })

      expect(mockFindWithDecryption).toHaveBeenCalledWith(
        mockEm,
        expect.anything(),
        expect.objectContaining({
          workflowInstanceId: instanceId,
          stepType: 'WAIT_FOR_CONDITION',
          status: 'ACTIVE',
          tenantId,
          organizationId,
        }),
        undefined,
        expect.objectContaining({ tenantId, organizationId })
      )
    })
  })
})
