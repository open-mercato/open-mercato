/**
 * Signals Feature Tests - Phase 9.1
 *
 * Tests for WAIT_FOR_SIGNAL step type and signal handling
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))

import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import { sendSignal, sendSignalByCorrelationKey, SignalError } from '../signal-handler'

const mockFindOneWithDecryption = findOneWithDecryption as jest.MockedFunction<typeof findOneWithDecryption>
const mockFindWithDecryption = findWithDecryption as jest.MockedFunction<typeof findWithDecryption>

describe('Workflow Signals - Phase 9.1', () => {
  // Test data
  const tenantId = 'tenant-123'
  const organizationId = 'org-123'
  const instanceId = 'instance-123'
  const userId = 'user-123'
  const definitionId = 'def-123'

  const mockEm = {
    flush: jest.fn(),
  } as any

  const mockLogWorkflowEvent = jest.fn()
  const mockExitStep = jest.fn()
  const mockFindValidTransitions = jest.fn()
  const mockExecuteTransition = jest.fn()
  const mockExecuteWorkflow = jest.fn()

  const mockContainer = {
    resolve: jest.fn((token: string) => {
      switch (token) {
        case 'eventLogger': return { logWorkflowEvent: mockLogWorkflowEvent }
        case 'stepHandler': return { exitStep: mockExitStep }
        case 'transitionHandler': return {
          findValidTransitions: mockFindValidTransitions,
          executeTransition: mockExecuteTransition,
        }
        case 'workflowExecutor': return { executeWorkflow: mockExecuteWorkflow }
        default: throw new Error(`Unexpected DI token in test: ${token}`)
      }
    }),
  } as any

  const mockInstance = {
    id: instanceId,
    definitionId,
    status: 'PAUSED',
    currentStepId: 'wait_approval',
    context: { orderId: 'order-123' },
    version: 1,
    workflowId: 'signal_workflow',
    startedAt: new Date(),
    retryCount: 0,
    createdAt: new Date(),
    tenantId,
    organizationId,
    updatedAt: new Date(),
  }

  const mockDefinition = {
    id: definitionId,
    workflowId: 'signal_workflow',
    tenantId,
    organizationId,
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
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance } as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)
        .mockResolvedValueOnce({ ...mockStepInstance } as any)

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
      const instance: any = {
        ...mockInstance,
        context: { existingData: 'value' },
        version: 1,
        workflowId: 'signal_workflow',
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      mockFindOneWithDecryption
        .mockResolvedValueOnce(instance)
        .mockResolvedValueOnce(mockDefinition as any)
        .mockResolvedValueOnce(mockStepInstance as any)

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
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance } as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)
        .mockResolvedValueOnce({ ...mockStepInstance } as any)

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
      mockFindOneWithDecryption.mockResolvedValueOnce(null) // Instance not found

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow(SignalError)

      mockFindOneWithDecryption.mockResolvedValueOnce(null)
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
      mockFindOneWithDecryption.mockResolvedValueOnce({
        ...mockInstance,
        status: 'RUNNING',
      } as any)

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
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance } as any) // Instance found
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

      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance } as any)
        .mockResolvedValueOnce(definitionWithoutSignal as any)

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
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance } as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)

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
      const baseExtras = {
        version: 1,
        workflowId: 'signal_workflow',
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const instance1 = { ...mockInstance, id: 'instance-1', correlationKey: 'batch-001', ...baseExtras }
      const instance2 = { ...mockInstance, id: 'instance-2', correlationKey: 'batch-001', ...baseExtras }
      const instance3 = { ...mockInstance, id: 'instance-3', correlationKey: 'batch-001', ...baseExtras }

      mockFindWithDecryption.mockResolvedValueOnce([instance1, instance2, instance3] as any)

      // Each sendSignal invocation does 3 findOneWithDecryption calls (instance, definition, step instance)
      mockFindOneWithDecryption
        .mockResolvedValueOnce(instance1 as any)
        .mockResolvedValueOnce(mockDefinition as any)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-1' } as any)
        .mockResolvedValueOnce(instance2 as any)
        .mockResolvedValueOnce(mockDefinition as any)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-2' } as any)
        .mockResolvedValueOnce(instance3 as any)
        .mockResolvedValueOnce(mockDefinition as any)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-3' } as any)

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
      mockFindWithDecryption.mockResolvedValueOnce([])

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
      const baseExtras = {
        version: 1,
        workflowId: 'signal_workflow',
        startedAt: new Date(),
        retryCount: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      const instance1 = { ...mockInstance, id: 'instance-1', correlationKey: 'batch-002', ...baseExtras }
      const instance2 = { ...mockInstance, id: 'instance-2', correlationKey: 'batch-002', ...baseExtras }

      mockFindWithDecryption.mockResolvedValueOnce([instance1, instance2] as any)

      mockFindOneWithDecryption
        // Instance 1 fails (not paused)
        .mockResolvedValueOnce({ ...instance1, status: 'RUNNING' } as any)
        // Instance 2 succeeds
        .mockResolvedValueOnce(instance2 as any)
        .mockResolvedValueOnce(mockDefinition as any)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-2' } as any)

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})

      const count = await sendSignalByCorrelationKey(mockEm, mockContainer, {
        correlationKey: 'batch-002',
        signalName: 'approval_granted',
        userId,
        tenantId,
        organizationId,
      })

      consoleErrorSpy.mockRestore()

      // Only 1 succeeded
      expect(count).toBe(1)
    })
  })

  describe('Multi-tenant Isolation', () => {
    it('should enforce tenant scope in instance lookup', async () => {
      mockFindOneWithDecryption.mockResolvedValueOnce(null) // Not found due to tenant mismatch

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId: 'different-tenant',
          organizationId,
        })
      ).rejects.toThrow('not found')

      // Verify findOneWithDecryption was called with tenant filter + scope
      expect(mockFindOneWithDecryption).toHaveBeenCalledWith(
        mockEm,
        expect.anything(),
        expect.objectContaining({
          id: instanceId,
          tenantId: 'different-tenant',
          organizationId,
        }),
        undefined,
        expect.objectContaining({ tenantId: 'different-tenant', organizationId }),
      )
    })

    it('should enforce tenant scope when loading definition', async () => {
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance } as any) // instance
        .mockResolvedValueOnce(null) // definition not found

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          signalName: 'test',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toThrow('definition not found')

      // Second call (definition) must be scoped + deletedAt: null
      expect(mockFindOneWithDecryption).toHaveBeenNthCalledWith(
        2,
        mockEm,
        expect.anything(),
        expect.objectContaining({
          id: definitionId,
          tenantId,
          organizationId,
          deletedAt: null,
        }),
        undefined,
        expect.objectContaining({ tenantId, organizationId }),
      )
    })

    it('should enforce tenant scope in correlation key lookup', async () => {
      mockFindWithDecryption.mockResolvedValueOnce([])

      const count = await sendSignalByCorrelationKey(mockEm, mockContainer, {
        correlationKey: 'test-key',
        signalName: 'test',
        userId,
        tenantId: 'tenant-a',
        organizationId: 'org-a',
      })

      expect(count).toBe(0)

      // Verify findWithDecryption was called with tenant filter
      expect(mockFindWithDecryption).toHaveBeenCalledWith(
        mockEm,
        expect.anything(),
        expect.objectContaining({
          correlationKey: 'test-key',
          status: 'PAUSED',
          tenantId: 'tenant-a',
          organizationId: 'org-a',
        }),
        undefined,
        expect.objectContaining({ tenantId: 'tenant-a', organizationId: 'org-a' }),
      )
    })
  })

  describe('Transition Execution', () => {
    it('should find and execute valid transitions after signal', async () => {
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance } as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)
        .mockResolvedValueOnce({ ...mockStepInstance } as any)

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
      mockFindOneWithDecryption
        .mockResolvedValueOnce(testInstance as any)
        .mockResolvedValueOnce(definitionNoTransitions as any)
        .mockResolvedValueOnce({ ...mockStepInstance } as any)

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
      mockFindOneWithDecryption
        .mockResolvedValueOnce(testInstance as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)
        .mockResolvedValueOnce({ ...mockStepInstance } as any)

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
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance } as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)
        .mockResolvedValueOnce({ ...mockStepInstance } as any)

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
