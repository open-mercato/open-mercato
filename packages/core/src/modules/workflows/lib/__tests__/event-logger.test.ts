/**
 * Event Logger Unit Tests
 */

import { EntityManager } from '@mikro-orm/core'
import { WorkflowEvent } from '../../data/entities'
import * as eventLogger from '../event-logger'
import type { WorkflowEventInput } from '../event-logger'

describe('Event Logger (Unit Tests)', () => {
  let mockEm: jest.Mocked<EntityManager>

  const testInstanceId = 'test-instance-id'
  const testStepInstanceId = 'test-step-instance-id'
  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'
  const testUserId = 'test-user-id'

  beforeEach(() => {
    // Create mock EntityManager
    mockEm = {
      create: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      count: jest.fn(),
      persistAndFlush: jest.fn(),
    } as any

    // Reset mocks
    jest.clearAllMocks()
  })

  // ============================================================================
  // Event Logging Tests
  // ============================================================================

  describe('logWorkflowEvent', () => {
    test('should log workflow event successfully', async () => {
      const mockEvent = {
        id: 'event-1',
        workflowInstanceId: testInstanceId,
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
        eventData: { workflowId: 'test-workflow' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        occurredAt: new Date(),
      } as WorkflowEvent

      mockEm.create.mockReturnValue(mockEvent)

      const input: WorkflowEventInput = {
        workflowInstanceId: testInstanceId,
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
        eventData: { workflowId: 'test-workflow' },
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      const result = await eventLogger.logWorkflowEvent(mockEm, input)

      expect(mockEm.create).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
          eventData: { workflowId: 'test-workflow' },
          tenantId: testTenantId,
          organizationId: testOrgId,
        })
      )
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
      expect(result).toBe(mockEvent)
    })

    test('should log event with step instance ID', async () => {
      const mockEvent = {
        id: 'event-1',
        workflowInstanceId: testInstanceId,
        stepInstanceId: testStepInstanceId,
        eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
        eventData: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
        occurredAt: new Date(),
      } as WorkflowEvent

      mockEm.create.mockReturnValue(mockEvent)

      const input: WorkflowEventInput = {
        workflowInstanceId: testInstanceId,
        stepInstanceId: testStepInstanceId,
        eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
        eventData: {},
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      await eventLogger.logWorkflowEvent(mockEm, input)

      expect(mockEm.create).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          stepInstanceId: testStepInstanceId,
        })
      )
    })

    test('should log event with user ID', async () => {
      const mockEvent = {
        id: 'event-1',
        workflowInstanceId: testInstanceId,
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
        eventData: {},
        userId: testUserId,
        tenantId: testTenantId,
        organizationId: testOrgId,
        occurredAt: new Date(),
      } as WorkflowEvent

      mockEm.create.mockReturnValue(mockEvent)

      const input: WorkflowEventInput = {
        workflowInstanceId: testInstanceId,
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
        eventData: {},
        userId: testUserId,
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      await eventLogger.logWorkflowEvent(mockEm, input)

      expect(mockEm.create).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          userId: testUserId,
        })
      )
    })
  })

  describe('logWorkflowEvents', () => {
    test('should log multiple events in batch', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
          eventData: {},
          tenantId: testTenantId,
          organizationId: testOrgId,
          occurredAt: new Date(),
        },
        {
          id: 'event-2',
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          eventData: {},
          tenantId: testTenantId,
          organizationId: testOrgId,
          occurredAt: new Date(),
        },
      ] as WorkflowEvent[]

      mockEm.create
        .mockReturnValueOnce(mockEvents[0])
        .mockReturnValueOnce(mockEvents[1])

      const inputs: WorkflowEventInput[] = [
        {
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
          eventData: {},
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
        {
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          eventData: {},
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
      ]

      const results = await eventLogger.logWorkflowEvents(mockEm, inputs)

      expect(mockEm.create).toHaveBeenCalledTimes(2)
      expect(mockEm.persistAndFlush).toHaveBeenCalledWith(mockEvents)
      expect(results).toEqual(mockEvents)
    })
  })

  // ============================================================================
  // Event Query Tests
  // ============================================================================

  describe('getWorkflowEvents', () => {
    test('should get all events for workflow instance', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
          eventData: {},
          occurredAt: new Date('2025-01-01T10:00:00Z'),
        },
        {
          id: 'event-2',
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          eventData: {},
          occurredAt: new Date('2025-01-01T10:05:00Z'),
        },
      ] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      const results = await eventLogger.getWorkflowEvents(mockEm, testInstanceId)

      expect(mockEm.find).toHaveBeenCalledWith(
        WorkflowEvent,
        { workflowInstanceId: testInstanceId },
        expect.objectContaining({
          orderBy: { occurredAt: 'ASC' },
        })
      )
      expect(results).toEqual(mockEvents)
    })

    test('should filter events by event types', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          eventData: {},
          occurredAt: new Date(),
        },
      ] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      await eventLogger.getWorkflowEvents(mockEm, testInstanceId, {
        eventTypes: [
          eventLogger.WorkflowEventTypes.STEP_ENTERED,
          eventLogger.WorkflowEventTypes.STEP_EXITED,
        ],
      })

      expect(mockEm.find).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          eventType: {
            $in: [
              eventLogger.WorkflowEventTypes.STEP_ENTERED,
              eventLogger.WorkflowEventTypes.STEP_EXITED,
            ],
          },
        }),
        expect.any(Object)
      )
    })

    test('should filter events by date range', async () => {
      const mockEvents = [] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      const fromDate = new Date('2025-01-01T00:00:00Z')
      const toDate = new Date('2025-01-31T23:59:59Z')

      await eventLogger.getWorkflowEvents(mockEm, testInstanceId, {
        fromDate,
        toDate,
      })

      expect(mockEm.find).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          occurredAt: {
            $gte: fromDate,
            $lte: toDate,
          },
        }),
        expect.any(Object)
      )
    })

    test('should filter events by step instance', async () => {
      const mockEvents = [] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      await eventLogger.getWorkflowEvents(mockEm, testInstanceId, {
        stepInstanceId: testStepInstanceId,
      })

      expect(mockEm.find).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          stepInstanceId: testStepInstanceId,
        }),
        expect.any(Object)
      )
    })

    test('should support pagination with limit and offset', async () => {
      const mockEvents = [] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      await eventLogger.getWorkflowEvents(mockEm, testInstanceId, {
        limit: 10,
        offset: 20,
      })

      expect(mockEm.find).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.any(Object),
        expect.objectContaining({
          limit: 10,
          offset: 20,
        })
      )
    })
  })

  describe('getStepEvents', () => {
    test('should get all events for step instance', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          stepInstanceId: testStepInstanceId,
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          eventData: {},
          occurredAt: new Date(),
        },
        {
          id: 'event-2',
          stepInstanceId: testStepInstanceId,
          eventType: eventLogger.WorkflowEventTypes.STEP_EXITED,
          eventData: {},
          occurredAt: new Date(),
        },
      ] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      const results = await eventLogger.getStepEvents(mockEm, testStepInstanceId)

      expect(mockEm.find).toHaveBeenCalledWith(
        WorkflowEvent,
        { stepInstanceId: testStepInstanceId },
        expect.objectContaining({
          orderBy: { occurredAt: 'ASC' },
        })
      )
      expect(results).toEqual(mockEvents)
    })
  })

  describe('getLatestEvent', () => {
    test('should get latest event for workflow instance', async () => {
      const mockEvent = {
        id: 'event-5',
        workflowInstanceId: testInstanceId,
        eventType: eventLogger.WorkflowEventTypes.STEP_EXITED,
        eventData: {},
        occurredAt: new Date(),
      } as WorkflowEvent

      mockEm.findOne.mockResolvedValue(mockEvent)

      const result = await eventLogger.getLatestEvent(mockEm, testInstanceId)

      expect(mockEm.findOne).toHaveBeenCalledWith(
        WorkflowEvent,
        { workflowInstanceId: testInstanceId },
        expect.objectContaining({
          orderBy: { occurredAt: 'DESC' },
        })
      )
      expect(result).toBe(mockEvent)
    })

    test('should get latest event of specific type', async () => {
      const mockEvent = {
        id: 'event-3',
        workflowInstanceId: testInstanceId,
        eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
        eventData: {},
        occurredAt: new Date(),
      } as WorkflowEvent

      mockEm.findOne.mockResolvedValue(mockEvent)

      const result = await eventLogger.getLatestEvent(
        mockEm,
        testInstanceId,
        eventLogger.WorkflowEventTypes.STEP_ENTERED
      )

      expect(mockEm.findOne).toHaveBeenCalledWith(
        WorkflowEvent,
        {
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
        },
        expect.any(Object)
      )
      expect(result).toBe(mockEvent)
    })

    test('should return null if no events found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const result = await eventLogger.getLatestEvent(mockEm, testInstanceId)

      expect(result).toBeNull()
    })
  })

  describe('countEvents', () => {
    test('should count all events for workflow instance', async () => {
      mockEm.count.mockResolvedValue(42)

      const result = await eventLogger.countEvents(mockEm, testInstanceId)

      expect(mockEm.count).toHaveBeenCalledWith(WorkflowEvent, {
        workflowInstanceId: testInstanceId,
      })
      expect(result).toBe(42)
    })

    test('should count events of specific type', async () => {
      mockEm.count.mockResolvedValue(10)

      const result = await eventLogger.countEvents(
        mockEm,
        testInstanceId,
        eventLogger.WorkflowEventTypes.STEP_ENTERED
      )

      expect(mockEm.count).toHaveBeenCalledWith(WorkflowEvent, {
        workflowInstanceId: testInstanceId,
        eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
      })
      expect(result).toBe(10)
    })
  })

  describe('getEventStatistics', () => {
    test('should calculate event statistics', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
          occurredAt: new Date('2025-01-01T10:00:00Z'),
        },
        {
          id: 'event-2',
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          occurredAt: new Date('2025-01-01T10:05:00Z'),
        },
        {
          id: 'event-3',
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          occurredAt: new Date('2025-01-01T10:10:00Z'),
        },
        {
          id: 'event-4',
          eventType: eventLogger.WorkflowEventTypes.STEP_EXITED,
          occurredAt: new Date('2025-01-01T10:15:00Z'),
        },
      ] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      const stats = await eventLogger.getEventStatistics(mockEm, testInstanceId)

      expect(stats.totalEvents).toBe(4)
      expect(stats.eventsByType).toEqual({
        [eventLogger.WorkflowEventTypes.WORKFLOW_STARTED]: 1,
        [eventLogger.WorkflowEventTypes.STEP_ENTERED]: 2,
        [eventLogger.WorkflowEventTypes.STEP_EXITED]: 1,
      })
      expect(stats.firstEvent).toEqual(new Date('2025-01-01T10:00:00Z'))
      expect(stats.lastEvent).toEqual(new Date('2025-01-01T10:15:00Z'))
    })

    test('should handle empty event list', async () => {
      mockEm.find.mockResolvedValue([])

      const stats = await eventLogger.getEventStatistics(mockEm, testInstanceId)

      expect(stats.totalEvents).toBe(0)
      expect(stats.eventsByType).toEqual({})
      expect(stats.firstEvent).toBeUndefined()
      expect(stats.lastEvent).toBeUndefined()
    })
  })

  describe('hasEventOccurred', () => {
    test('should return true if event has occurred', async () => {
      mockEm.count.mockResolvedValue(1)

      const result = await eventLogger.hasEventOccurred(
        mockEm,
        testInstanceId,
        eventLogger.WorkflowEventTypes.WORKFLOW_STARTED
      )

      expect(result).toBe(true)
      expect(mockEm.count).toHaveBeenCalledWith(WorkflowEvent, {
        workflowInstanceId: testInstanceId,
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
      })
    })

    test('should return false if event has not occurred', async () => {
      mockEm.count.mockResolvedValue(0)

      const result = await eventLogger.hasEventOccurred(
        mockEm,
        testInstanceId,
        eventLogger.WorkflowEventTypes.WORKFLOW_COMPLETED
      )

      expect(result).toBe(false)
    })
  })

  describe('getEventTimeline', () => {
    test('should generate event timeline with summaries', async () => {
      const mockEvents = [
        {
          id: 'event-1',
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
          eventData: { workflowId: 'checkout' },
          occurredAt: new Date('2025-01-01T10:00:00Z'),
          userId: 'user-1',
        },
        {
          id: 'event-2',
          workflowInstanceId: testInstanceId,
          stepInstanceId: 'step-1',
          eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
          eventData: { stepName: 'Payment', stepId: 'payment' },
          occurredAt: new Date('2025-01-01T10:05:00Z'),
        },
        {
          id: 'event-3',
          workflowInstanceId: testInstanceId,
          eventType: eventLogger.WorkflowEventTypes.WORKFLOW_COMPLETED,
          eventData: { result: { success: true } },
          occurredAt: new Date('2025-01-01T10:10:00Z'),
        },
      ] as WorkflowEvent[]

      mockEm.find.mockResolvedValue(mockEvents)

      const timeline = await eventLogger.getEventTimeline(mockEm, testInstanceId)

      expect(timeline).toHaveLength(3)
      expect(timeline[0]).toEqual({
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_STARTED,
        occurredAt: new Date('2025-01-01T10:00:00Z'),
        userId: 'user-1',
        summary: 'Workflow started (checkout)',
      })
      expect(timeline[1]).toEqual({
        eventType: eventLogger.WorkflowEventTypes.STEP_ENTERED,
        occurredAt: new Date('2025-01-01T10:05:00Z'),
        stepInstanceId: 'step-1',
        summary: 'Entered step: Payment',
      })
      expect(timeline[2]).toEqual({
        eventType: eventLogger.WorkflowEventTypes.WORKFLOW_COMPLETED,
        occurredAt: new Date('2025-01-01T10:10:00Z'),
        summary: 'Workflow completed with result',
      })
    })
  })

  // ============================================================================
  // Helper Functions Tests
  // ============================================================================

  describe('isValidEventType', () => {
    test('should return true for valid event types', () => {
      expect(eventLogger.isValidEventType(eventLogger.WorkflowEventTypes.WORKFLOW_STARTED)).toBe(true)
      expect(eventLogger.isValidEventType(eventLogger.WorkflowEventTypes.STEP_ENTERED)).toBe(true)
      expect(eventLogger.isValidEventType(eventLogger.WorkflowEventTypes.USER_TASK_CREATED)).toBe(true)
    })

    test('should return false for invalid event types', () => {
      expect(eventLogger.isValidEventType('INVALID_EVENT_TYPE')).toBe(false)
      expect(eventLogger.isValidEventType('')).toBe(false)
    })
  })

  describe('getAllEventTypes', () => {
    test('should return all known event types', () => {
      const allTypes = eventLogger.getAllEventTypes()

      expect(allTypes).toContain(eventLogger.WorkflowEventTypes.WORKFLOW_STARTED)
      expect(allTypes).toContain(eventLogger.WorkflowEventTypes.STEP_ENTERED)
      expect(allTypes).toContain(eventLogger.WorkflowEventTypes.TRANSITION_EXECUTED)
      expect(allTypes).toContain(eventLogger.WorkflowEventTypes.USER_TASK_CREATED)
      expect(allTypes.length).toBeGreaterThan(20) // Should have many event types
    })
  })
})
