/**
 * Compensation (Saga Pattern) Tests - Phase 8, Step 8.2
 *
 * Tests for automatic compensation on workflow failure
 */

import { compensateWorkflow, shouldCompensateActivity } from '../compensation-handler'
import { logWorkflowEvent, getWorkflowEvents } from '../event-logger'
import { executeActivity } from '../activity-executor'

// Mock dependencies
jest.mock('../event-logger')
jest.mock('../activity-executor')

const mockLogWorkflowEvent = logWorkflowEvent as jest.MockedFunction<typeof logWorkflowEvent>
const mockGetWorkflowEvents = getWorkflowEvents as jest.MockedFunction<typeof getWorkflowEvents>
const mockExecuteActivity = executeActivity as jest.MockedFunction<typeof executeActivity>

describe('Compensation (Saga Pattern) - Phase 8', () => {
  // Test data
  const tenantId = 'tenant-123'
  const organizationId = 'org-123'
  const instanceId = 'instance-123'
  const userId = 'user-123'

  const mockEm = {
    find: jest.fn(),
    flush: jest.fn(),
  } as any

  const mockContainer = {} as any

  const mockInstance = {
    version: '1.0.0',
    startedAt: new Date('2024-01-01T10:00:00Z'),
    retryCount: 0,
    createdAt: new Date('2024-01-01T09:00:00Z'),
    updatedAt: new Date('2024-01-01T10:00:00Z'),
    id: instanceId,
    definitionId: 'def-123',
    status: 'FAILED',
    context: {
      orderId: 'order-123',
      paymentId: 'payment-123',
      inventoryReservationId: 'reservation-123',
    },
    errorMessage: 'Payment failed',
    tenantId,
    organizationId,
  }

  const mockDefinition = {
    id: 'def-123',
    definition: {
      steps: [],
      transitions: [
        {
          transitionId: 't1',
          fromStepId: 'start',
          toStepId: 'end',
          activities: [
            {
              activityId: 'charge_payment',
              activityName: 'Charge Payment',
              activityType: 'EXECUTE_FUNCTION',
              config: { functionName: 'chargePayment' },
              compensation: {
                activityId: 'refund_payment',
                automatic: true,
              },
            },
            {
              activityId: 'refund_payment',
              activityName: 'Refund Payment',
              activityType: 'EXECUTE_FUNCTION',
              config: { functionName: 'refundPayment' },
            },
            {
              activityId: 'reserve_inventory',
              activityName: 'Reserve Inventory',
              activityType: 'EXECUTE_FUNCTION',
              config: { functionName: 'reserveInventory' },
              compensation: {
                activityId: 'release_inventory',
                automatic: true,
              },
            },
            {
              activityId: 'release_inventory',
              activityName: 'Release Inventory',
              activityType: 'EXECUTE_FUNCTION',
              config: { functionName: 'releaseInventory' },
            },
          ],
        },
      ],
    },
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockLogWorkflowEvent.mockResolvedValue({} as any)
    mockEm.flush.mockResolvedValue(undefined)
  })

  describe('Basic Compensation', () => {
    test('should trigger compensation on workflow failure', async () => {
      // Mock completed activities (in reverse chronological order - LIFO)
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: {
            activityId: 'reserve_inventory',
            activityName: 'Reserve Inventory',
            output: { reservationId: 'reservation-123' },
          },
          occurredAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: {
            activityId: 'charge_payment',
            activityName: 'Charge Payment',
            output: { paymentId: 'payment-123' },
          },
          occurredAt: new Date('2024-01-01T10:01:00Z'),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)

      // Mock successful compensation executions
      mockExecuteActivity.mockResolvedValue({
        success: true,
        activityId: 'test-activity',
        activityType: 'CALL_API',
        retryCount: 0,
        output: { refunded: true },
        executionTimeMs: 100,
      })

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any,
        { userId }
      )

      // Verify workflow status updated to COMPENSATING
      expect(mockInstance.status).toBe('COMPENSATED')
      expect(mockEm.flush).toHaveBeenCalled()

      // Verify compensation started event
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          workflowInstanceId: instanceId,
          eventType: 'COMPENSATION_STARTED',
          eventData: expect.objectContaining({
            reason: 'Payment failed',
          }),
        })
      )

      // Verify result
      expect(result.status).toBe('COMPLETED')
      expect(result.totalActivities).toBe(2)
      expect(result.compensatedActivities).toBe(2)
      expect(result.failedCompensations).toEqual([])
    })

    test('should execute compensation activities in reverse order (LIFO)', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'reserve_inventory', activityName: 'Reserve Inventory' },
          occurredAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date('2024-01-01T10:01:00Z'),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: true, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, output: {}, executionTimeMs: 50 })

      await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any
      )

      // Verify compensation activities executed in reverse order
      const activityCalls = mockExecuteActivity.mock.calls

      // First call should compensate the most recent activity (reserve_inventory → release_inventory)
      // executeActivity(em, container, activityDef, context)
      expect(activityCalls[0][2].activityId).toBe('release_inventory')

      // Second call should compensate the earlier activity (charge_payment → refund_payment)
      expect(activityCalls[1][2].activityId).toBe('refund_payment')
    })

    test('should update workflow status to COMPENSATED on successful completion', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date(),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: true, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, output: {}, executionTimeMs: 50 })

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any
      )

      expect(mockInstance.status).toBe('COMPENSATED')
      expect(result.status).toBe('COMPLETED')

      // Verify COMPENSATION_COMPLETED event logged
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'COMPENSATION_COMPLETED',
          eventData: expect.objectContaining({
            totalActivities: 1,
            compensatedActivities: 1,
          }),
        })
      )
    })

    test('should pass original activity context to compensation activity', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: {
            activityId: 'charge_payment',
            activityName: 'Charge Payment',
            output: { transactionId: 'txn-123', amount: 100 },
          },
          occurredAt: new Date(),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: true, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, output: {}, executionTimeMs: 50 })

      await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any
      )

      // Verify executeActivity called with workflow context
      expect(mockExecuteActivity).toHaveBeenCalledWith(
        mockEm,
        mockContainer,
        expect.objectContaining({ activityId: 'refund_payment' }),
        expect.objectContaining({
          workflowInstance: mockInstance,
          workflowContext: mockInstance.context,
        })
      )
    })
  })

  describe('Partial Compensation', () => {
    test('should skip activities without compensation defined', async () => {
      const definitionWithPartialCompensation = {
        id: 'def-123',
        definition: {
          steps: [],
          transitions: [
            {
              transitionId: 't1',
              activities: [
                {
                  activityId: 'activity1',
                  activityName: 'Activity 1',
                  activityType: 'EXECUTE_FUNCTION',
                  config: {},
                  compensation: { activityId: 'compensate1' },
                },
                {
                  activityId: 'compensate1',
                  activityName: 'Compensate 1',
                  activityType: 'EXECUTE_FUNCTION',
                  config: {},
                },
                {
                  activityId: 'activity2',
                  activityName: 'Activity 2 (no compensation)',
                  activityType: 'EXECUTE_FUNCTION',
                  config: {},
                  // No compensation defined
                },
              ],
            },
          ],
        },
      }

      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'activity2', activityName: 'Activity 2' },
          occurredAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'activity1', activityName: 'Activity 1' },
          occurredAt: new Date('2024-01-01T10:01:00Z'),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: true, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, output: {}, executionTimeMs: 50 })

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        definitionWithPartialCompensation as any
      )

      // Only one compensation should execute (activity2 has no compensation)
      expect(mockExecuteActivity).toHaveBeenCalledTimes(1)
      expect(result.compensatedActivities).toBe(1)
      expect(result.totalActivities).toBe(2)
    })

    test('should limit compensation count when maxCompensations specified', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'activity3', activityName: 'Activity 3' },
          occurredAt: new Date('2024-01-01T10:03:00Z'),
        },
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'activity2', activityName: 'Activity 2' },
          occurredAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'activity1', activityName: 'Activity 1' },
          occurredAt: new Date('2024-01-01T10:01:00Z'),
        },
      ]

      const definitionWith3Activities = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            {
              transitionId: 't1',
              activities: [
                { activityId: 'activity1', activityName: 'Activity 1', activityType: 'EXECUTE_FUNCTION', config: {}, compensation: { activityId: 'comp1' } },
                { activityId: 'comp1', activityName: 'Comp 1', activityType: 'EXECUTE_FUNCTION', config: {} },
                { activityId: 'activity2', activityName: 'Activity 2', activityType: 'EXECUTE_FUNCTION', config: {}, compensation: { activityId: 'comp2' } },
                { activityId: 'comp2', activityName: 'Comp 2', activityType: 'EXECUTE_FUNCTION', config: {} },
                { activityId: 'activity3', activityName: 'Activity 3', activityType: 'EXECUTE_FUNCTION', config: {}, compensation: { activityId: 'comp3' } },
                { activityId: 'comp3', activityName: 'Comp 3', activityType: 'EXECUTE_FUNCTION', config: {} },
              ],
            },
          ],
        },
      }

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: true, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, output: {}, executionTimeMs: 50 })

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        definitionWith3Activities as any,
        { maxCompensations: 2 } // Only compensate 2 most recent
      )

      // Only 2 compensations should execute
      expect(mockExecuteActivity).toHaveBeenCalledTimes(2)
      expect(result.compensatedActivities).toBe(2)
    })
  })

  describe('Error Handling', () => {
    test('should continue compensation when continueOnError=true (default)', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'reserve_inventory', activityName: 'Reserve Inventory' },
          occurredAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date('2024-01-01T10:01:00Z'),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)

      // First compensation fails, second succeeds
      mockExecuteActivity
        .mockResolvedValueOnce({ success: false, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, error: 'Inventory service unavailable', executionTimeMs: 50 })
        .mockResolvedValueOnce({ success: true, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, output: {}, executionTimeMs: 50 })

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any,
        { continueOnError: true }
      )

      // Both compensations should be attempted
      expect(mockExecuteActivity).toHaveBeenCalledTimes(2)

      // Result should be PARTIAL (some succeeded, some failed)
      expect(result.status).toBe('PARTIAL')
      expect(result.compensatedActivities).toBe(1)
      expect(result.failedCompensations).toContain('reserve_inventory')
      expect(result.errors).toContain('Failed to compensate Reserve Inventory: Inventory service unavailable')
    })

    test('should stop compensation immediately when continueOnError=false', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'reserve_inventory', activityName: 'Reserve Inventory' },
          occurredAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date('2024-01-01T10:01:00Z'),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: false, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, error: 'Compensation failed', executionTimeMs: 50 })

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any,
        { continueOnError: false }
      )

      // Only first compensation should be attempted
      expect(mockExecuteActivity).toHaveBeenCalledTimes(1)
      expect(result.status).toBe('FAILED')
      expect(result.compensatedActivities).toBe(0)
    })

    test('should handle missing compensation activity definition', async () => {
      const definitionMissingCompensation = {
        id: 'def-123',
        definition: {
          steps: [],
          transitions: [
            {
              transitionId: 't1',
              activities: [
                {
                  activityId: 'charge_payment',
                  activityName: 'Charge Payment',
                  activityType: 'EXECUTE_FUNCTION',
                  config: {},
                  compensation: {
                    activityId: 'nonexistent_compensation', // This doesn't exist
                  },
                },
              ],
            },
          ],
        },
      }

      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date(),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        definitionMissingCompensation as any
      )

      // No compensation executed, but doesn't crash
      expect(mockExecuteActivity).not.toHaveBeenCalled()
      expect(result.failedCompensations).toContain('charge_payment')
    })

    test('should handle compensation activity throwing exception', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date(),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockRejectedValue(new Error('Network error'))

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any,
        { continueOnError: true }
      )

      expect(result.status).toBe('FAILED')
      expect(result.failedCompensations).toContain('charge_payment')
      expect(result.errors).toContain('Exception compensating Charge Payment: Network error')
    })

    test('should mark workflow as FAILED if compensation fails critically', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date(),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: false, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, error: 'Critical failure', executionTimeMs: 50 })

      const result = await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any,
        { continueOnError: false }
      )

      expect(result.status).toBe('FAILED')
      expect(mockInstance.status).toBe('FAILED')

      // Verify COMPENSATION_FAILED event logged
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'COMPENSATION_FAILED',
        })
      )
    })
  })

  describe('Event Logging', () => {
    test('should log COMPENSATION_STARTED event', async () => {
      mockEm.find.mockResolvedValue([])

      await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any,
        { userId, maxCompensations: 5, continueOnError: true }
      )

      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          workflowInstanceId: instanceId,
          eventType: 'COMPENSATION_STARTED',
          eventData: expect.objectContaining({
            reason: 'Payment failed',
            maxCompensations: 5,
            continueOnError: true,
          }),
          userId,
          tenantId,
          organizationId,
        })
      )
    })

    test('should log COMPENSATION_ACTIVITY_STARTED and COMPLETED events', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date(),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: true, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, output: { refunded: true }, executionTimeMs: 123 })

      await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any
      )

      // Verify COMPENSATION_ACTIVITY_STARTED logged
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'COMPENSATION_ACTIVITY_STARTED',
          eventData: expect.objectContaining({
            originalActivityId: 'charge_payment',
            compensationActivityId: 'refund_payment',
            compensationActivityName: 'Refund Payment',
          }),
        })
      )

      // Verify COMPENSATION_ACTIVITY_COMPLETED logged
      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'COMPENSATION_ACTIVITY_COMPLETED',
          eventData: expect.objectContaining({
            originalActivityId: 'charge_payment',
            compensationActivityId: 'refund_payment',
            output: { refunded: true },
            executionTimeMs: 123,
          }),
        })
      )
    })

    test('should log COMPENSATION_COMPLETED event with summary', async () => {
      const completedActivities = [
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'reserve_inventory', activityName: 'Reserve Inventory' },
          occurredAt: new Date('2024-01-01T10:02:00Z'),
        },
        {
          eventType: 'ACTIVITY_COMPLETED',
          eventData: { activityId: 'charge_payment', activityName: 'Charge Payment' },
          occurredAt: new Date('2024-01-01T10:01:00Z'),
        },
      ]

      mockEm.find.mockResolvedValue(completedActivities)
      mockExecuteActivity.mockResolvedValue({ success: true, activityId: 'test-activity', activityType: 'CALL_API', retryCount: 0, output: {}, executionTimeMs: 50 })

      await compensateWorkflow(
        mockEm,
        mockContainer,
        mockInstance as any,
        mockDefinition as any
      )

      expect(mockLogWorkflowEvent).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          eventType: 'COMPENSATION_COMPLETED',
          eventData: expect.objectContaining({
            totalActivities: 2,
            compensatedActivities: 2,
            failedCompensations: [],
          }),
        })
      )
    })
  })

  describe('Utility Functions', () => {
    test('shouldCompensateActivity returns true when compensation defined', () => {
      const activity = {
        activityId: 'test',
        activityName: 'Test',
        activityType: 'EXECUTE_FUNCTION',
        config: {},
        compensation: { activityId: 'compensate_test' },
      }

      expect(shouldCompensateActivity(activity)).toBe(true)
    })

    test('shouldCompensateActivity returns false when no compensation defined', () => {
      const activity = {
        activityId: 'test',
        activityName: 'Test',
        activityType: 'EXECUTE_FUNCTION',
        config: {},
      }

      expect(shouldCompensateActivity(activity)).toBe(false)
    })
  })
})
