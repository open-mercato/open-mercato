/**
 * Signals Feature Tests - Phase 9.1
 *
 * Tests for WAIT_FOR_SIGNAL step type and signal handling
 */

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))
jest.mock('../workflow-executor', () => ({
  dispatchAgentOutcomeForCurrentStep: jest.fn(),
}))

import {
  findOneWithDecryption,
  findWithDecryption,
} from '@open-mercato/shared/lib/encryption/find'
import {
  sendSignal,
  sendSignalByCorrelationKey,
  sendSignalByCorrelationKeyWithResults,
  SignalError,
} from '../signal-handler'
import { dispatchAgentOutcomeForCurrentStep } from '../workflow-executor'
import { StepInstance, WorkflowDefinition, WorkflowInstance } from '../../data/entities'

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
    nativeUpdate: jest.fn(),
  } as any

  const mockLogWorkflowEvent = jest.fn()
  const mockExitStep = jest.fn()
  const mockFindValidTransitions = jest.fn()
  const mockExecuteTransition = jest.fn()
  const mockExecuteWorkflow = jest.fn()
  const mockCompleteWorkflow = jest.fn()

  const mockContainer = {
    resolve: jest.fn((token: string) => {
      switch (token) {
        case 'eventLogger': return { logWorkflowEvent: mockLogWorkflowEvent }
        case 'stepHandler': return { exitStep: mockExitStep }
        case 'transitionHandler': return {
          findValidTransitions: mockFindValidTransitions,
          executeTransition: mockExecuteTransition,
        }
        case 'workflowExecutor': return {
          executeWorkflow: mockExecuteWorkflow,
          completeWorkflow: mockCompleteWorkflow,
        }
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

  const twoWaitDefinition = {
    ...mockDefinition,
    definition: {
      steps: [
        { stepId: 'start', stepType: 'START' },
        { stepId: 'wait_approval', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: 'approval_granted' } },
        { stepId: 'wait_second', stepType: 'WAIT_FOR_SIGNAL', signalConfig: { signalName: 'approval_granted' } },
        { stepId: 'end', stepType: 'END' },
      ],
      transitions: [
        { transitionId: 't1', fromStepId: 'start', toStepId: 'wait_approval', trigger: 'auto' },
        { transitionId: 't2', fromStepId: 'wait_approval', toStepId: 'wait_second', trigger: 'auto' },
        { transitionId: 't3', fromStepId: 'wait_second', toStepId: 'end', trigger: 'auto' },
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
    mockEm.nativeUpdate.mockResolvedValue(1)
    mockExitStep.mockResolvedValue(undefined)
    mockExecuteWorkflow.mockResolvedValue({} as any)
    mockCompleteWorkflow.mockResolvedValue(undefined)
    ;(dispatchAgentOutcomeForCurrentStep as jest.Mock).mockResolvedValue(null)
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

  describe('Concurrent delivery (#7185)', () => {
    type InstanceRow = { status: string; currentStepId: string }

    afterEach(() => {
      mockFindOneWithDecryption.mockReset()
      mockFindWithDecryption.mockReset()
      mockEm.nativeUpdate.mockReset()
    })

    function wireSharedRow(row: InstanceRow, readers: number) {
      let pendingReads = readers
      let releaseReads: () => void = () => {}
      const allRead = new Promise<void>((resolve) => { releaseReads = resolve })

      mockFindOneWithDecryption.mockImplementation((async (_em: unknown, entity: { name?: string }) => {
        if (entity === WorkflowInstance) {
          const snapshot = { ...mockInstance, ...row, context: { ...mockInstance.context } }
          pendingReads -= 1
          if (pendingReads <= 0) releaseReads()
          await allRead
          return snapshot
        }
        if (entity === WorkflowDefinition) return { ...mockDefinition }
        if (entity === StepInstance) return { ...mockStepInstance }
        return null
      }) as any)

      mockEm.nativeUpdate.mockImplementation(async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
        if (row.status !== where.status || row.currentStepId !== where.currentStepId) return 0
        row.status = data.status as string
        return 1
      })
    }

    const deliver = () =>
      sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'approval_granted',
        payload: { approved: true },
        userId,
        tenantId,
        organizationId,
      })

    it('advances a PAUSED instance exactly once when the same signal arrives three times concurrently', async () => {
      const row: InstanceRow = { status: 'PAUSED', currentStepId: 'wait_approval' }
      wireSharedRow(row, 3)

      const results = await Promise.allSettled([deliver(), deliver(), deliver()])

      const fulfilled = results.filter((result) => result.status === 'fulfilled')
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(2)
      for (const loser of rejected) {
        expect(loser.reason).toBeInstanceOf(SignalError)
        expect(loser.reason.code).toBe('WORKFLOW_NOT_PAUSED')
      }

      expect(mockEm.nativeUpdate).toHaveBeenCalledTimes(3)
      expect(mockEm.nativeUpdate).toHaveBeenCalledWith(
        WorkflowInstance,
        expect.objectContaining({
          id: instanceId,
          tenantId,
          organizationId,
          status: 'PAUSED',
          currentStepId: 'wait_approval',
        }),
        expect.objectContaining({ status: 'RUNNING' }),
      )
      expect(mockLogWorkflowEvent).toHaveBeenCalledTimes(1)
      expect(mockExitStep).toHaveBeenCalledTimes(1)
      expect(mockExecuteTransition).toHaveBeenCalledTimes(1)
      expect(mockExecuteWorkflow).toHaveBeenCalledTimes(1)
      expect(row.status).toBe('RUNNING')
    })

    it('refuses a stale delivery once the instance has parked on a different step', async () => {
      const row: InstanceRow = { status: 'PAUSED', currentStepId: 'wait_approval' }
      wireSharedRow(row, 1)
      mockEm.nativeUpdate.mockImplementationOnce(async () => {
        row.currentStepId = 'review_task'
        return 0
      })

      await expect(deliver()).rejects.toMatchObject({ code: 'WORKFLOW_NOT_PAUSED' })
      expect(mockLogWorkflowEvent).not.toHaveBeenCalled()
      expect(mockExitStep).not.toHaveBeenCalled()
      expect(mockExecuteTransition).not.toHaveBeenCalled()
      expect(mockEm.flush).not.toHaveBeenCalled()
    })

    it('does not claim the instance when validation rejects the signal', async () => {
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
      ).rejects.toMatchObject({ code: 'SIGNAL_NAME_MISMATCH' })
      expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
    })

    it('refuses an expectedStepId delivery when the instance is PAUSED on a later wait for the same signal', async () => {
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance, status: 'PAUSED', currentStepId: 'wait_second' } as any)
        .mockResolvedValueOnce({ ...twoWaitDefinition } as any)

      await expect(
        sendSignal(mockEm, mockContainer, {
          instanceId,
          expectedStepId: 'wait_approval',
          signalName: 'approval_granted',
          userId,
          tenantId,
          organizationId,
        })
      ).rejects.toMatchObject({ code: 'WORKFLOW_NOT_PAUSED' })
      expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
      expect(mockLogWorkflowEvent).not.toHaveBeenCalled()
      expect(mockExecuteTransition).not.toHaveBeenCalled()
    })

    it('fan-out does not advance an instance listed on wait1 that a concurrent fan-out already parked on wait2', async () => {
      mockFindWithDecryption.mockResolvedValueOnce([
        { ...mockInstance, correlationKey: 'batch-wait', currentStepId: 'wait_approval' },
      ] as any)
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...mockInstance, status: 'PAUSED', currentStepId: 'wait_second' } as any)
        .mockResolvedValueOnce({ ...twoWaitDefinition } as any)

      const result = await sendSignalByCorrelationKeyWithResults(mockEm, mockContainer, {
        correlationKey: 'batch-wait',
        signalName: 'approval_granted',
        userId,
        tenantId,
        organizationId,
      })

      expect(result).toEqual({
        count: 0,
        failures: [{ instanceId, code: 'WORKFLOW_NOT_PAUSED', message: 'Workflow is not paused' }],
      })
      expect(mockEm.nativeUpdate).not.toHaveBeenCalled()
      expect(mockLogWorkflowEvent).not.toHaveBeenCalled()
      expect(mockExecuteTransition).not.toHaveBeenCalled()
      expect(mockExecuteWorkflow).not.toHaveBeenCalled()
    })

    it('advances each instance exactly once when three fan-out calls race over two same-signal waits', async () => {
      const ids = ['instance-a', 'instance-b']
      const rows = new Map<string, InstanceRow>(ids.map((id) => [id, { status: 'PAUSED', currentStepId: 'wait_approval' }]))
      const nextStep: Record<string, string> = { wait_approval: 'wait_second', wait_second: 'end' }
      const signalReceived = new Map<string, number>()

      let listings = 0
      let releaseListings: () => void = () => {}
      const allListed = new Promise<void>((resolve) => { releaseListings = resolve })
      let releaseStraggler: () => void = () => {}
      const firstTwoSettled = new Promise<void>((resolve) => { releaseStraggler = resolve })
      mockFindWithDecryption.mockImplementation((async () => {
        const listed = ids
          .filter((id) => rows.get(id)!.status === 'PAUSED')
          .map((id) => ({ ...mockInstance, id, correlationKey: 'batch-race', ...rows.get(id)! }))
        listings += 1
        const isStraggler = listings === 3
        if (isStraggler) releaseListings()
        await allListed
        if (isStraggler) await firstTwoSettled
        return listed
      }) as any)
      mockFindOneWithDecryption.mockImplementation((async (_em: unknown, entity: unknown, where: { id?: string; workflowInstanceId?: string }) => {
        if (entity === WorkflowInstance) {
          const row = rows.get(where.id as string)
          return row ? { ...mockInstance, id: where.id, ...row, context: {} } : null
        }
        if (entity === WorkflowDefinition) return { ...twoWaitDefinition }
        if (entity === StepInstance) return { ...mockStepInstance, workflowInstanceId: where.workflowInstanceId }
        return null
      }) as any)
      mockEm.nativeUpdate.mockImplementation(async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
        const row = rows.get(where.id as string)
        if (!row || row.status !== where.status || row.currentStepId !== where.currentStepId) return 0
        row.status = data.status as string
        return 1
      })
      mockLogWorkflowEvent.mockImplementation(async (_em: unknown, event: { workflowInstanceId: string }) => {
        signalReceived.set(event.workflowInstanceId, (signalReceived.get(event.workflowInstanceId) ?? 0) + 1)
        return {}
      })
      mockFindValidTransitions.mockImplementation(async (_em: unknown, _instance: unknown, fromStepId: string) => [
        { transition: { transitionId: `t_${fromStepId}`, fromStepId, toStepId: nextStep[fromStepId], trigger: 'auto' }, isValid: true },
      ])
      mockExecuteTransition.mockImplementation(async (_em: unknown, _container: unknown, instance: { id: string }, _from: string, toStepId: string) => {
        rows.get(instance.id)!.currentStepId = toStepId
        return { success: true }
      })
      mockExecuteWorkflow.mockImplementation(async (_em: unknown, _container: unknown, id: string) => {
        const row = rows.get(id)!
        row.status = row.currentStepId === 'end' ? 'COMPLETED' : 'PAUSED'
        return {}
      })

      const fanOut = () =>
        sendSignalByCorrelationKeyWithResults(mockEm, mockContainer, {
          correlationKey: 'batch-race',
          signalName: 'approval_granted',
          userId,
          tenantId,
          organizationId,
        })
      const firstTwo = Promise.all([fanOut(), fanOut()])
      const straggler = fanOut()
      const settled = await firstTwo
      releaseStraggler()
      const results = [...settled, await straggler]

      expect(results.reduce((sum, result) => sum + result.count, 0)).toBe(2)
      const failures = results.flatMap((result) => result.failures)
      expect(failures).toHaveLength(4)
      for (const failure of failures) expect(failure.code).toBe('WORKFLOW_NOT_PAUSED')
      for (const id of ids) {
        expect(rows.get(id)).toEqual({ status: 'PAUSED', currentStepId: 'wait_second' })
        expect(signalReceived.get(id)).toBe(1)
      }
    })

    it('hands the wait back when the delivery fails before its first write commits, so a retry still lands', async () => {
      const row: InstanceRow = { status: 'PAUSED', currentStepId: 'wait_approval' }
      const instance: any = { ...mockInstance, context: { orderId: 'order-123' } }
      mockFindOneWithDecryption.mockImplementation((async (_em: unknown, entity: unknown) => {
        if (entity === WorkflowInstance) return instance
        if (entity === WorkflowDefinition) return { ...mockDefinition }
        if (entity === StepInstance) return { ...mockStepInstance }
        return null
      }) as any)
      mockEm.nativeUpdate.mockImplementation(async (_entity: unknown, where: Record<string, unknown>, data: Record<string, unknown>) => {
        if (row.status !== where.status || row.currentStepId !== where.currentStepId) return 0
        row.status = data.status as string
        instance.status = row.status
        return 1
      })
      mockLogWorkflowEvent.mockRejectedValueOnce(new Error('flush failed'))

      await expect(deliver()).rejects.toThrow('flush failed')

      expect(row.status).toBe('PAUSED')
      expect(mockEm.nativeUpdate).toHaveBeenLastCalledWith(
        WorkflowInstance,
        expect.objectContaining({ id: instanceId, status: 'RUNNING', currentStepId: 'wait_approval' }),
        expect.objectContaining({ status: 'PAUSED' }),
      )
      expect(instance.status).toBe('PAUSED')
      expect(instance.context).toEqual({ orderId: 'order-123' })
      expect(mockExitStep).not.toHaveBeenCalled()
      expect(mockExecuteTransition).not.toHaveBeenCalled()

      await expect(deliver()).resolves.toBeUndefined()
      expect(row.status).toBe('RUNNING')
      expect(mockLogWorkflowEvent).toHaveBeenCalledTimes(2)
      expect(mockExecuteTransition).toHaveBeenCalledTimes(1)
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

    it('reports which instances failed alongside the success count', async () => {
      const instance1 = { ...mockInstance, id: 'instance-1', correlationKey: 'batch-003' }
      const instance2 = { ...mockInstance, id: 'instance-2', correlationKey: 'batch-003' }
      const instance3 = { ...mockInstance, id: 'instance-3', correlationKey: 'batch-003' }

      mockFindWithDecryption.mockResolvedValueOnce([instance1, instance2, instance3] as any)
      mockFindOneWithDecryption
        .mockResolvedValueOnce({ ...instance1 } as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)
        .mockResolvedValueOnce({ ...instance2 } as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-2' } as any)
        .mockResolvedValueOnce({ ...instance3 } as any)
        .mockResolvedValueOnce({ ...mockDefinition } as any)
        .mockResolvedValueOnce({ ...mockStepInstance, workflowInstanceId: 'instance-3' } as any)
      // instance-1 loses its claim to a concurrent delivery
      mockEm.nativeUpdate.mockResolvedValueOnce(0)
      // instance-3 fails for an internal reason after it was claimed
      mockExecuteTransition
        .mockResolvedValueOnce({ success: true })
        .mockRejectedValueOnce(new Error('connection reset by peer'))

      const result = await sendSignalByCorrelationKeyWithResults(mockEm, mockContainer, {
        correlationKey: 'batch-003',
        signalName: 'approval_granted',
        userId,
        tenantId,
        organizationId,
      })

      expect(result.count).toBe(1)
      expect(result.failures).toEqual([
        { instanceId: 'instance-1', code: 'WORKFLOW_NOT_PAUSED', message: 'Workflow is not paused' },
        { instanceId: 'instance-3', code: 'SIGNAL_DELIVERY_FAILED', message: 'Failed to deliver signal' },
      ])
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
    it('completes the instance when a resumed agent outcome is unhandled', async () => {
      const agentInstance = { ...mockInstance, currentStepId: 'agent' }
      const agentDefinition = {
        ...mockDefinition,
        definition: {
          steps: [
            {
              stepId: 'agent',
              stepType: 'AUTOMATED',
              activities: [{ activityType: 'INVOKE_AGENT' }],
            },
          ],
          transitions: [],
        },
      }
      const agentStepInstance = { ...mockStepInstance, stepId: 'agent' }
      mockFindOneWithDecryption
        .mockResolvedValueOnce(agentInstance as any)
        .mockResolvedValueOnce(agentDefinition as any)
        .mockResolvedValueOnce(agentStepInstance as any)
      ;(dispatchAgentOutcomeForCurrentStep as jest.Mock).mockResolvedValueOnce({
        kind: 'failed',
        error: 'unwired agent outcome',
      })

      await sendSignal(mockEm, mockContainer, {
        instanceId,
        signalName: 'agent_orchestrator.proposal.ready',
        agentOutcome: 'rejected',
        tenantId,
        organizationId,
      })

      expect(mockCompleteWorkflow).toHaveBeenCalledWith(
        mockEm,
        mockContainer,
        instanceId,
        'FAILED',
        { error: 'unwired agent outcome' },
      )
      expect(mockExecuteWorkflow).not.toHaveBeenCalled()
    })

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
        expect.any(Object),
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
