/**
 * Signals Feature Tests - Phase 9.1
 *
 * Tests for WAIT_FOR_SIGNAL step type and signal handling
 */

import { sendSignal, sendSignalByCorrelationKey, SignalError } from '../signal-handler'
import { logWorkflowEvent } from '../event-logger'
import { executeWorkflow } from '../workflow-executor'
import * as stepHandler from '../step-handler'
import * as transitionHandler from '../transition-handler'

// Mock dependencies
jest.mock('../event-logger')
jest.mock('../workflow-executor')
jest.mock('../step-handler')
jest.mock('../transition-handler')

const mockLogWorkflowEvent = logWorkflowEvent as jest.MockedFunction<typeof logWorkflowEvent>
const mockExecuteWorkflow = executeWorkflow as jest.MockedFunction<typeof executeWorkflow>
const mockExitStep = stepHandler.exitStep as jest.MockedFunction<typeof stepHandler.exitStep>
const mockFindValidTransitions = transitionHandler.findValidTransitions as jest.MockedFunction<
  typeof transitionHandler.findValidTransitions
>
const mockExecuteTransition = transitionHandler.executeTransition as jest.MockedFunction<
  typeof transitionHandler.executeTransition
>

describe('Workflow Signals - Phase 9.1', () => {
  // Test data
  const tenantId = 'tenant-123'
  const organizationId = 'org-123'
  const instanceId = 'instance-123'
  const userId = 'user-123'
  const definitionId = 'def-123'

  const mockEm = {
    findOne: jest.fn(),
    find: jest.fn(),
    flush: jest.fn(),
  } as any

  const mockContainer = {} as any

  const mockInstance = {
    id: instanceId,
    definitionId,
    status: 'PAUSED',
    currentStepId: 'wait_approval',
    context: { orderId: 'order-123' },
    tenantId,
    organizationId,
    updatedAt: new Date(),
  }

  const mockDefinition = {
    id: definitionId,
    workflowId: 'signal_workflow',
    definition: {
      steps: [
        { stepId: 'start', stepType: 'START' },
        {
          stepId: 'wait_approval',
          stepType: 'WAIT_FOR_SIGNAL',
          stepName: 'Wait for Approval',
          signalConfig: {
            signalName: 'approval_granted',
            timeout: 'PT5M',
          },
        },
        { stepId: 'process', stepType: 'AUTOMATED' },
        { stepId: 'end', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't1', fromStepId: 'start', toStepId: 'wait_approval', trigger: 'auto' },
        { transitionId: 't2', fromStepId: 'wait_approval', toStepId: 'process', trigger: 'auto' },
        { transitionId: 't3', fromStepId: 'process', toStepId: 'end', trigger: 'auto' },
      ],
    },
  }

  const mockStepInstance = {
    id: 'step-instance-123',
    workflowInstanceId: instanceId,
    stepId: 'wait_approval',
    status: 'ACTIVE',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockLogWorkflowEvent.mockResolvedValue({} as any)
    mockEm.flush.mockResolvedValue(undefined)
    mockExitStep.mockResolvedValue(undefined)
    mockExecuteWorkflow.mockResolvedValue({} as any)
    mockFindValidTransitions.mockResolvedValue([
      {
        transition: { toStepId: 'process', fromStepId: 'wait_approval', trigger: 'auto' },
        isValid: true,
      },
    ])
    mockExecuteTransition.mockResolvedValue({ success: true })
  })

  describe('Basic Signal Sending', () => {
    it('should send signal to paused workflow instance', async () => {
      mockEm.findOne
        .mockResolvedValueOnce({ ...mockInstance }) // Instance lookup
        .mockResolvedValueOnce({ ...mockDefinition }) // Definition lookup
        .mockResolvedValueOnce({ ...mockStepInstance }) // Step instance lookup

      await sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'approval_granted',
        payload: { approved: true },
        userId,
        tenantId,
        organizationId,
      })

      // Verify SIGNAL_RECEIVED event logged
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          workflowInstanceId: instanceId,
          eventType: 'SIGNAL_RECEIVED',
          eventData: expect.objectContaining({
            signalName: 'approval_granted',
            payload: { approved: true },
          }),
          userId,
          tenantId,
          organizationId,
        })
      )

      // Verify step exited
      expect(mockExitStep).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({ id: mockStepInstance.id }),
        expect.objectContaining({
          signalName: 'approval_granted',
          payload: { approved: true },
        })
      )

      // Verify workflow execution resumed
      expect(mockExecuteWorkflow).toHaveBeenCalledWith(
        mockEm,
        mockContainer,
        instanceId,
        expect.objectContaining({ userId })
      )
    })

    it('should merge signal payload into workflow context', async () => {
      const instance = { ...mockInstance, context: { existingData: 'value' } }
      mockEm.findOne
        .mockResolvedValueOnce(instance) // Instance
        .mockResolvedValueOnce(mockDefinition) // Definition
        .mockResolvedValueOnce(mockStepInstance) // Step instance

      await sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'approval_granted',
        payload: { name: 'John', amount: 100 },
        userId,
        tenantId,
        organizationId,
      })

      // Verify context was updated
      expect(instance.context.existingData).toBe('value')
      expect(instance.context.name).toBe('John')
      expect(instance.context.amount).toBe(100)
      expect(instance.context.signal_approval_granted_payload).toEqual({
        name: 'John',
        amount: 100,
      })
      expect(instance.context.signal_approval_granted_receivedAt).toBeDefined()
    })

    it('should handle signal without payload', async () => {
      mockEm.findOne
        .mockResolvedValueOnce({ ...mockInstance })
        .mockResolvedValueOnce({ ...mockDefinition })
        .mockResolvedValueOnce({ ...mockStepInstance })

      await sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'approval_granted',
        // No payload
        userId,
        tenantId,
        organizationId,
      })

      // Should work without errors
      expect(mockExecuteWorkflow).toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should throw INSTANCE_NOT_FOUND when workflow does not exist', async () => {
      mockEm.findOne.mockResolvedValueOnce(null) // Instance not found

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow(SignalError)

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow('not found')
    })

    it('should throw WORKFLOW_NOT_PAUSED when workflow is not paused', async () => {
      mockEm.findOne.mockResolvedValueOnce({
        ...mockInstance,
        status: 'RUNNING',
      })

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow('not paused')
    })

    it('should throw DEFINITION_NOT_FOUND when definition does not exist', async () => {
      mockEm.findOne
        .mockResolvedValueOnce({ ...mockInstance }) // Instance found
        .mockResolvedValueOnce(null) // Definition not found

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow('definition not found')
    })

    it('should throw NOT_WAITING_FOR_SIGNAL when current step is not WAIT_FOR_SIGNAL', async () => {
      const definitionWithoutSignal = {
        ...mockDefinition,
        definition: {
          steps: [
            { stepId: 'start', stepType: 'START' },
            { stepId: 'wait_approval', stepType: 'AUTOMATED' }, // Not WAIT_FOR_SIGNAL
            { stepId: 'end', stepType: 'END' },
          ],
          transitions: [],
        },
      }

      mockEm.findOne
        .mockResolvedValueOnce({ ...mockInstance })
        .mockResolvedValueOnce(definitionWithoutSignal)

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow('not waiting for signal')
    })

    it('should throw SIGNAL_NAME_MISMATCH when signal name does not match', async () => {
      mockEm.findOne
        .mockResolvedValueOnce({ ...mockInstance })
        .mockResolvedValueOnce({ ...mockDefinition })

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'wrong_signal_name',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow('mismatch')
    })
  })

  describe('Signal by Correlation Key', () => {
    it('should send signal to multiple workflows with same correlation key', async () => {
      const instance1 = { ...mockInstance, id: 'instance-1', correlationKey: 'batch-001' }
      const instance2 = { ...mockInstance, id: 'instance-2', correlationKey: 'batch-001' }
      const instance3 = { ...mockInstance, id: 'instance-3', correlationKey: 'batch-001' }

      mockEm.find.mockResolvedValueOnce([instance1, instance2, instance3])

      // Mock for each instance
      mockEm.findOne
        // Instance 1
        .mockResolvedValueOnce(instance1)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-1' })
        // Instance 2
        .mockResolvedValueOnce(instance2)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-2' })
        // Instance 3
        .mockResolvedValueOnce(instance3)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-3' })

      const count = await sendSignalByCorrelationKey(mockEm, mockContainer, {
        correlationKey: 'batch-001',
        signalName: 'approval_granted',
        payload: { batchApproved: true },
        userId,
        tenantId,
        organizationId,
      })

      expect(count).toBe(3)

      // Verify all instances processed
      expect(mockExecuteWorkflow).toHaveBeenCalledTimes(3)
      expect(mockLogWorkflowEvent).toHaveBeenCalledTimes(3)
    })

    it('should return 0 when no workflows match correlation key', async () => {
      mockEm.find.mockResolvedValueOnce([]) // No workflows found

      const count = await sendSignalByCorrelationKey(mockEm, mockContainer, {
        correlationKey: 'non-existent',
        signalName: 'test',
        userId,
        tenantId,
        organizationId,
      })

      expect(count).toBe(0)
      expect(mockExecuteWorkflow).not.toHaveBeenCalled()
    })

    it('should continue processing other instances if one fails', async () => {
      const instance1 = { ...mockInstance, id: 'instance-1', correlationKey: 'batch-002' }
      const instance2 = { ...mockInstance, id: 'instance-2', correlationKey: 'batch-002' }

      mockEm.find.mockResolvedValueOnce([instance1, instance2])

      // Instance 1 fails (not paused)
      mockEm.findOne
        .mockResolvedValueOnce({ ...instance1, status: 'RUNNING' })
        // Instance 2 succeeds
        .mockResolvedValueOnce(instance2)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-2' })

      const count = await sendSignalByCorrelationKey(mockEm, mockContainer, {
        correlationKey: 'batch-002',
        signalName: 'approval_granted',
        userId,
        tenantId,
        organizationId,
      })

      // Only 1 succeeded
      expect(count).toBe(1)
    })
  })

  describe('Multi-tenant Isolation', () => {
    it('should enforce tenant scope in instance lookup', async () => {
      mockEm.findOne.mockResolvedValueOnce(null) // Not found due to tenant mismatch

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId: 'different-tenant',
          organizationId,
        })
      ).rejects.toThrow('not found')

      // Verify findOne was called with tenant filter
      expect(mockEm.findOne).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          id: instanceId,
          tenantId: 'different-tenant',
          organizationId,
        })
      )
    })

    it('should enforce tenant scope in correlation key lookup', async () => {
      mockEm.find.mockResolvedValueOnce([]) // No workflows in different tenant

      const count = await sendSignalByCorrelationKey(mockEm, mockContainer, {
        correlationKey: 'test-key',
        signalName: 'test',
        userId,
        tenantId: 'tenant-a',
        organizationId: 'org-a',
      })

      expect(count).toBe(0)

      // Verify find was called with tenant filter
      expect(mockEm.find).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          correlationKey: 'test-key',
          status: 'PAUSED',
          tenantId: 'tenant-a',
          organizationId: 'org-a',
        })
      )
    })
  })

  describe('Transition Execution', () => {
    it('should find and execute valid transitions after signal', async () => {
      mockEm.findOne
        .mockResolvedValueOnce({ ...mockInstance })
        .mockResolvedValueOnce({ ...mockDefinition })
        .mockResolvedValueOnce({ ...mockStepInstance })

      await sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'approval_granted',
        userId,
        tenantId,
        organizationId,
      })

      // Verify transitions were evaluated
      expect(mockFindValidTransitions).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({ id: instanceId }),
        'wait_approval',
        expect.objectContaining({
          workflowContext: expect.any(Object),
          userId,
        })
      )

      // Verify transition was executed
      expect(mockExecuteTransition).toHaveBeenCalledWith(
        mockEm,
        mockContainer,
        expect.objectContaining({ id: instanceId }),
        'wait_approval',
        'process',
        expect.any(Object)
      )
    })

    it('should handle case with no automatic transitions', async () => {
      const definitionNoTransitions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [], // No transitions
        },
      }

      const testInstance = { ...mockInstance }
      mockEm.findOne
        .mockResolvedValueOnce(testInstance)
        .mockResolvedValueOnce(definitionNoTransitions)
        .mockResolvedValueOnce({ ...mockStepInstance })

      await sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'approval_granted',
        userId,
        tenantId,
        organizationId,
      })

      // Should mark as RUNNING but not execute transitions
      expect(testInstance.status).toBe('RUNNING')
      expect(mockExecuteWorkflow).not.toHaveBeenCalled()
    })

    it('should handle case with no valid transitions', async () => {
      const testInstance = { ...mockInstance }
      mockEm.findOne
        .mockResolvedValueOnce(testInstance)
        .mockResolvedValueOnce({ ...mockDefinition })
        .mockResolvedValueOnce({ ...mockStepInstance })

      mockFindValidTransitions.mockResolvedValueOnce([
        { transition: null, isValid: false }, // No valid transitions
      ])

      await sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'approval_granted',
        userId,
        tenantId,
        organizationId,
      })

      // Should mark as RUNNING but not execute transitions
      expect(testInstance.status).toBe('RUNNING')
      expect(mockExecuteTransition).not.toHaveBeenCalled()
    })
  })

  describe('Event Logging', () => {
    it('should log SIGNAL_RECEIVED event with full details', async () => {
      mockEm.findOne
        .mockResolvedValueOnce({ ...mockInstance })
        .mockResolvedValueOnce({ ...mockDefinition })
        .mockResolvedValueOnce({ ...mockStepInstance })

      const payload = { approved: true, approver: 'Alice', timestamp: '2024-01-01T10:00:00Z' }

      await sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'approval_granted',
        payload,
        userId,
        tenantId,
        organizationId,
      })

      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          workflowInstanceId: instanceId,
          eventType: 'SIGNAL_RECEIVED',
          eventData: expect.objectContaining({
            signalName: 'approval_granted',
            payload,
          }),
          userId,
          tenantId,
          organizationId,
        })
      )
    })
  })
})
