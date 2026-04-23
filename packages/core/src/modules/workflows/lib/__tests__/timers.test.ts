/**
 * Timers Feature Tests - WAIT_FOR_TIMER step type
 *
 * Tests for:
 *  - handleWaitForTimerStep (via executeStep): immediate fire, PAUSED + enqueue, validation
 *  - fireTimer: happy path, rejects if not PAUSED, rejects if wrong step type
 */

import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import * as stepHandler from '../step-handler'
import { fireTimer, TimerError } from '../timer-handler'
import { logWorkflowEvent } from '../event-logger'
import { executeWorkflow } from '../workflow-executor'
import * as transitionHandler from '../transition-handler'
import { enqueueTimerJob } from '../activity-executor'
import type {
  WorkflowDefinition,
  WorkflowInstance,
  StepInstance,
} from '../../data/entities'

jest.mock('../event-logger')
jest.mock('../workflow-executor')
jest.mock('../transition-handler')
jest.mock('../activity-executor', () => {
  const actual = jest.requireActual('../activity-executor') as Record<string, unknown>
  return {
    ...actual,
    enqueueTimerJob: jest.fn(),
  }
})

const mockLogWorkflowEvent = logWorkflowEvent as jest.MockedFunction<typeof logWorkflowEvent>
const mockExecuteWorkflow = executeWorkflow as jest.MockedFunction<typeof executeWorkflow>
const mockFindValidTransitions =
  transitionHandler.findValidTransitions as jest.MockedFunction<
    typeof transitionHandler.findValidTransitions
  >
const mockExecuteTransition = transitionHandler.executeTransition as jest.MockedFunction<
  typeof transitionHandler.executeTransition
>
const mockEnqueueTimerJob = enqueueTimerJob as jest.MockedFunction<typeof enqueueTimerJob>

describe('WAIT_FOR_TIMER step', () => {
  const tenantId = '00000000-0000-4000-8000-000000000001'
  const organizationId = '00000000-0000-4000-8000-000000000002'
  const definitionId = '00000000-0000-4000-8000-000000000003'
  const instanceId = '00000000-0000-4000-8000-000000000004'

  const makeDefinition = (stepConfig: any): Partial<WorkflowDefinition> => ({
    id: definitionId,
    workflowId: 'timer-workflow',
    version: 1,
    definition: {
      steps: [
        { stepId: 'start', stepName: 'Start', stepType: 'START' },
        {
          stepId: 'timer_step',
          stepName: 'Wait for Timer',
          stepType: 'WAIT_FOR_TIMER',
          config: stepConfig,
        },
        { stepId: 'end', stepName: 'End', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't1', fromStepId: 'timer_step', toStepId: 'end', trigger: 'auto' },
      ],
    },
    tenantId,
    organizationId,
  })

  const makeInstance = (overrides: Partial<WorkflowInstance> = {}): WorkflowInstance =>
    ({
      id: instanceId,
      definitionId,
      workflowId: 'timer-workflow',
      version: 1,
      status: 'RUNNING',
      currentStepId: 'timer_step',
      context: {},
      tenantId,
      organizationId,
      startedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
      retryCount: 0,
      ...overrides,
    } as unknown as WorkflowInstance)

  let mockEm: jest.Mocked<EntityManager>

  beforeEach(() => {
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persist: jest.fn(function persist(this: any) { return this }),
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
    } as any

    jest.clearAllMocks()
    mockLogWorkflowEvent.mockResolvedValue({} as any)
    mockExecuteWorkflow.mockResolvedValue({} as any)
    mockEnqueueTimerJob.mockResolvedValue('job-xyz')
    mockFindValidTransitions.mockResolvedValue([
      { transition: { toStepId: 'end', fromStepId: 'timer_step', trigger: 'auto' }, isValid: true },
    ])
    mockExecuteTransition.mockResolvedValue({ success: true })
  })

  describe('handleWaitForTimerStep (via executeStep)', () => {
    test('fires immediately when until is in the past', async () => {
      const definition = makeDefinition({ until: new Date(Date.now() - 60_000).toISOString() })
      const instance = makeInstance()
      mockEm.findOne.mockResolvedValue(definition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: instanceId,
        stepId: 'timer_step',
        stepType: 'WAIT_FOR_TIMER',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId,
        organizationId,
      } as unknown as StepInstance
      mockEm.create.mockReturnValue(mockStepInstance)

      const result = await stepHandler.executeStep(mockEm, instance, 'timer_step', {
        workflowContext: {},
      })

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData?.timerFiredImmediately).toBe(true)
      expect(result.outputData?.stepType).toBe('WAIT_FOR_TIMER')
      expect(mockEnqueueTimerJob).not.toHaveBeenCalled()
      expect(instance.status).toBe('RUNNING')
    })

    test('fires immediately when duration resolves to 0', async () => {
      const definition = makeDefinition({ duration: 'PT0S' })
      const instance = makeInstance()
      mockEm.findOne.mockResolvedValue(definition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: instanceId,
        stepId: 'timer_step',
        stepType: 'WAIT_FOR_TIMER',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId,
        organizationId,
      } as unknown as StepInstance
      mockEm.create.mockReturnValue(mockStepInstance)

      const result = await stepHandler.executeStep(mockEm, instance, 'timer_step', {
        workflowContext: {},
      })

      expect(result.status).toBe('COMPLETED')
      expect(result.outputData?.timerFiredImmediately).toBe(true)
      expect(mockEnqueueTimerJob).not.toHaveBeenCalled()
    })

    test('pauses workflow and enqueues delayed timer job for future fire', async () => {
      const definition = makeDefinition({ duration: 'PT5M' })
      const instance = makeInstance()
      mockEm.findOne.mockResolvedValue(definition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: instanceId,
        stepId: 'timer_step',
        stepType: 'WAIT_FOR_TIMER',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId,
        organizationId,
      } as unknown as StepInstance
      mockEm.create.mockReturnValue(mockStepInstance)

      const result = await stepHandler.executeStep(mockEm, instance, 'timer_step', {
        workflowContext: {},
        userId: 'user-1',
      })

      expect(result.status).toBe('WAITING')
      expect(result.waitReason).toBe('TIMER')
      expect(result.outputData?.jobId).toBe('job-xyz')
      expect(result.outputData?.duration).toBe('PT5M')
      expect(instance.status).toBe('PAUSED')
      expect(instance.pausedAt).toBeDefined()

      expect(mockEnqueueTimerJob).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowInstanceId: instanceId,
          stepInstanceId: mockStepInstance.id,
          tenantId,
          organizationId,
          userId: 'user-1',
        })
      )

      const enqueueCallArgs = mockEnqueueTimerJob.mock.calls[0][0]
      expect(enqueueCallArgs.delayMs).toBeGreaterThan(0)
      expect(enqueueCallArgs.delayMs).toBeLessThanOrEqual(5 * 60 * 1000)

      // TIMER_AWAITING logged
      const timerAwaitingCall = mockLogWorkflowEvent.mock.calls.find(
        ([, event]) => (event as any).eventType === 'TIMER_AWAITING'
      )
      expect(timerAwaitingCall).toBeDefined()
      expect((timerAwaitingCall![1] as any).eventData.jobId).toBe('job-xyz')
    })

    test('fails with TIMER_CONFIG_MISSING when no duration/until is provided', async () => {
      const definition = makeDefinition({})
      const instance = makeInstance()
      mockEm.findOne.mockResolvedValue(definition as WorkflowDefinition)

      const mockStepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: instanceId,
        stepId: 'timer_step',
        stepType: 'WAIT_FOR_TIMER',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId,
        organizationId,
      } as unknown as StepInstance
      mockEm.create.mockReturnValue(mockStepInstance)

      const result = await stepHandler.executeStep(mockEm, instance, 'timer_step', {
        workflowContext: {},
      })

      expect(result.status).toBe('FAILED')
      expect(result.error).toMatch(/duration|until/i)
      expect(mockEnqueueTimerJob).not.toHaveBeenCalled()
    })
  })

  describe('fireTimer', () => {
    const mockContainer = {} as any

    const makePausedInstance = (): any =>
      ({
        id: instanceId,
        definitionId,
        workflowId: 'timer-workflow',
        version: 1,
        status: 'PAUSED',
        currentStepId: 'timer_step',
        context: {},
        tenantId,
        organizationId,
        startedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        retryCount: 0,
      })

    test('fires timer, exits step, and resumes workflow', async () => {
      const instance = makePausedInstance()
      const definition = makeDefinition({ duration: 'PT5M' })
      const stepInstance = {
        id: 'step-instance-1',
        workflowInstanceId: instanceId,
        stepId: 'timer_step',
        status: 'ACTIVE',
        enteredAt: new Date(),
        tenantId,
        organizationId,
      } as any

      mockEm.findOne
        .mockResolvedValueOnce(instance)
        .mockResolvedValueOnce(definition)
        .mockResolvedValueOnce(stepInstance)

      await fireTimer(mockEm, mockContainer, {
        instanceId,
        stepInstanceId: stepInstance.id,
        tenantId,
        organizationId,
      })

      // TIMER_FIRED event logged
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          workflowInstanceId: instanceId,
          eventType: 'TIMER_FIRED',
          eventData: expect.objectContaining({ stepId: 'timer_step' }),
        })
      )

      expect(mockExecuteTransition).toHaveBeenCalledWith(
        mockEm,
        mockContainer,
        expect.objectContaining({ id: instanceId }),
        'timer_step',
        'end',
        expect.any(Object)
      )

      expect(mockExecuteWorkflow).toHaveBeenCalled()
    })

    test('rejects when instance is not PAUSED', async () => {
      const runningInstance = { ...makePausedInstance(), status: 'RUNNING' }
      mockEm.findOne
        .mockResolvedValueOnce(runningInstance)
        .mockResolvedValueOnce(runningInstance)

      await expect(
        fireTimer(mockEm, mockContainer, {
          instanceId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow(TimerError)
      await expect(
        fireTimer(mockEm, mockContainer, {
          instanceId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow(/not paused/i)
    })

    test('rejects when current step is not WAIT_FOR_TIMER', async () => {
      const instance = makePausedInstance()
      const wrongStepDef = {
        id: definitionId,
        workflowId: 'timer-workflow',
        definition: {
          steps: [
            { stepId: 'timer_step', stepType: 'AUTOMATED' },
          ],
          transitions: [],
        },
      }
      mockEm.findOne
        .mockResolvedValueOnce(instance)
        .mockResolvedValueOnce(wrongStepDef)

      await expect(
        fireTimer(mockEm, mockContainer, {
          instanceId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow(/not waiting for timer/i)
    })

    test('rejects when instance is not found', async () => {
      mockEm.findOne.mockResolvedValueOnce(null)

      await expect(
        fireTimer(mockEm, mockContainer, {
          instanceId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow(/not found/i)
    })
  })
})
