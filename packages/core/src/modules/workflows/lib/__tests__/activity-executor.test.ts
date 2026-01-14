/**
 * Activity Executor Unit Tests
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import { WorkflowInstance } from '../../data/entities'
import * as activityExecutor from '../activity-executor'
import type { ActivityDefinition, ActivityContext } from '../activity-executor'

// Mock global fetch
global.fetch = jest.fn()

describe('Activity Executor (Unit Tests)', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let mockInstance: WorkflowInstance
  let mockContext: ActivityContext

  const testInstanceId = 'test-instance-id'
  const testTenantId = 'test-tenant-id'
  const testOrgId = 'test-org-id'

  beforeEach(() => {
    // Create mock EntityManager
    mockEm = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      flush: jest.fn(),
    } as any

    // Create mock DI container
    mockContainer = {
      resolve: jest.fn(),
    } as any

    // Create mock workflow instance
    mockInstance = {
      id: testInstanceId,
      definitionId: 'test-definition-id',
      workflowId: 'test-workflow',
      version: 1,
      currentStepId: 'step-1',
      status: 'RUNNING',
      context: {
        user: { email: 'user@example.com', name: 'John Doe' },
        orderId: 'order-123',
      },
      startedAt: new Date(),
      retryCount: 0,
      tenantId: testTenantId,
      organizationId: testOrgId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WorkflowInstance

    // Create mock context
    mockContext = {
      workflowInstance: mockInstance,
      workflowContext: mockInstance.context,
      userId: 'user-123',
    }

    // Reset mocks
    jest.clearAllMocks()
    ;(global.fetch as jest.Mock).mockClear()
  })

  // ============================================================================
  // SEND_EMAIL Activity Tests
  // ============================================================================

  describe('SEND_EMAIL activity', () => {
    test('should execute SEND_EMAIL activity successfully (console mode)', async () => {
      const activity: ActivityDefinition = {
        activityId: 'activity-1',
        activityName: 'Welcome Email',
        activityType: 'SEND_EMAIL',
        config: {
          to: 'user@example.com',
          subject: 'Welcome!',
          body: 'Welcome to our service',
        },
      }

      // No email service available
      mockContainer.resolve.mockImplementation(() => {
        throw new Error('emailService not registered')
      })

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output.sent).toBe(true)
      expect(result.output.to).toBe('user@example.com')
      expect(result.output.via).toBe('console')
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Send email to user@example.com')
      )

      consoleSpy.mockRestore()
    })

    test('should execute SEND_EMAIL with email service if available', async () => {
      const mockEmailService = {
        send: jest.fn().mockResolvedValue({ messageId: 'msg-123' }),
      }

      mockContainer.resolve.mockReturnValue(mockEmailService)

      const activity: ActivityDefinition = {
        activityId: 'activity-2',
        activityName: 'Welcome Email',
        activityType: 'SEND_EMAIL',
        config: {
          to: 'user@example.com',
          subject: 'Welcome!',
          template: 'welcome',
          templateData: { name: 'John' },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output.via).toBe('emailService')
      expect(mockEmailService.send).toHaveBeenCalledWith({
        to: 'user@example.com',
        subject: 'Welcome!',
        template: 'welcome',
        templateData: { name: 'John' },
        body: undefined,
      })
    })

    test('should fail SEND_EMAIL if missing required fields', async () => {
      const activity: ActivityDefinition = {
        activityId: 'activity-3',
        activityName: 'Invalid Email',
        activityType: 'SEND_EMAIL',
        config: {
          to: 'user@example.com',
          // Missing subject
        },
      }

      mockContainer.resolve.mockImplementation(() => {
        throw new Error('emailService not registered')
      })

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('requires "to" and "subject"')
    })

    test('should interpolate variables in SEND_EMAIL config', async () => {
      const activity: ActivityDefinition = {
        activityId: 'activity-4',
        activityName: 'Dynamic Email',
        activityType: 'SEND_EMAIL',
        config: {
          to: '{{user.email}}',
          subject: 'Hello {{user.name}}',
          body: 'Your order {{orderId}} is ready',
        },
      }

      mockContainer.resolve.mockImplementation(() => {
        throw new Error('emailService not registered')
      })

      const consoleSpy = jest.spyOn(console, 'log').mockImplementation()

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output.to).toBe('user@example.com')
      expect(result.output.subject).toBe('Hello John Doe')
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('user@example.com: Hello John Doe')
      )

      consoleSpy.mockRestore()
    })
  })

  // ============================================================================
  // EMIT_EVENT Activity Tests
  // ============================================================================

  describe('EMIT_EVENT activity', () => {
    test('should execute EMIT_EVENT activity successfully', async () => {
      const mockEventBus = {
        emitEvent: jest.fn().mockResolvedValue(undefined),
      }

      mockContainer.resolve.mockReturnValue(mockEventBus)

      const activity: ActivityDefinition = {
        activityId: 'activity-5',
        activityName: 'Order Created Event',
        activityType: 'EMIT_EVENT',
        config: {
          eventName: 'order.created',
          payload: {
            orderId: 'order-123',
            status: 'pending',
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output.emitted).toBe(true)
      expect(result.output.eventName).toBe('order.created')
      expect(mockEventBus.emitEvent).toHaveBeenCalledWith(
        'order.created',
        expect.objectContaining({
          orderId: 'order-123',
          status: 'pending',
          _workflow: expect.objectContaining({
            workflowInstanceId: testInstanceId,
            tenantId: testTenantId,
          }),
        })
      )
    })

    test('should fail EMIT_EVENT if event bus not available', async () => {
      mockContainer.resolve.mockImplementation(() => {
        throw new Error('eventBus not registered')
      })

      const activity: ActivityDefinition = {
        activityId: 'activity-6',
        activityName: 'Test Event',
        activityType: 'EMIT_EVENT',
        config: {
          eventName: 'test.event',
          payload: {},
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('eventBus not registered')
    })

    test('should fail EMIT_EVENT if missing eventName', async () => {
      const mockEventBus = {
        emitEvent: jest.fn().mockResolvedValue(undefined),
      }

      mockContainer.resolve.mockReturnValue(mockEventBus)

      const activity: ActivityDefinition = {
        activityId: 'activity-7',
        activityName: 'Invalid Event',
        activityType: 'EMIT_EVENT',
        config: {
          // Missing eventName
          payload: {},
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('requires "eventName"')
    })
  })

  // ============================================================================
  // UPDATE_ENTITY Activity Tests
  // ============================================================================

  describe('UPDATE_ENTITY activity', () => {
    test('should execute UPDATE_ENTITY activity successfully', async () => {
      const mockQueryEngine = {
        update: jest.fn().mockResolvedValue({ updated: 1 }),
      }

      mockContainer.resolve.mockReturnValue(mockQueryEngine)

      const activity: ActivityDefinition = {
        activityId: 'activity-8',
        activityName: 'Update Order Status',
        activityType: 'UPDATE_ENTITY',
        config: {
          entityType: 'orders',
          entityId: 'order-123',
          updates: {
            status: 'confirmed',
            confirmedAt: new Date().toISOString(),
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output.updated).toBe(true)
      expect(mockQueryEngine.update).toHaveBeenCalledWith({
        entity: 'orders',
        where: { id: 'order-123' },
        data: expect.objectContaining({
          status: 'confirmed',
        }),
        tenantId: testTenantId,
        organizationId: testOrgId,
      })
    })

    test('should fail UPDATE_ENTITY if query engine not available', async () => {
      mockContainer.resolve.mockImplementation(() => {
        throw new Error('queryEngine not registered')
      })

      const activity: ActivityDefinition = {
        activityId: 'activity-9',
        activityName: 'Test Update',
        activityType: 'UPDATE_ENTITY',
        config: {
          entityType: 'orders',
          entityId: 'order-123',
          updates: { status: 'confirmed' },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('queryEngine not registered')
    })

    test('should fail UPDATE_ENTITY if missing required fields', async () => {
      const mockQueryEngine = {
        update: jest.fn().mockResolvedValue({ updated: 1 }),
      }

      mockContainer.resolve.mockReturnValue(mockQueryEngine)

      const activity: ActivityDefinition = {
        activityId: 'activity-10',
        activityName: 'Invalid Update',
        activityType: 'UPDATE_ENTITY',
        config: {
          entityType: 'orders',
          // Missing entityId and updates
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('requires "entityType", "entityId", and "updates"')
    })
  })

  // ============================================================================
  // CALL_WEBHOOK Activity Tests
  // ============================================================================

  describe('CALL_WEBHOOK activity', () => {
    test('should execute CALL_WEBHOOK activity successfully', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ success: true, orderId: 'order-123' }),
      })

      const activity: ActivityDefinition = {
        activityId: 'activity-11',
        activityName: 'Notify External System',
        activityType: 'CALL_WEBHOOK',
        config: {
          url: 'https://example.com/webhook',
          method: 'POST',
          body: {
            event: 'order.created',
            orderId: 'order-123',
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output.status).toBe(200)
      expect(result.output.result).toEqual({ success: true, orderId: 'order-123' })
      expect(global.fetch).toHaveBeenCalledWith(
        'https://example.com/webhook',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
          body: expect.any(String),
        })
      )
    })

    test('should handle non-JSON webhook responses', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async () => 'Success',
      })

      const activity: ActivityDefinition = {
        activityId: 'activity-12',
        activityName: 'Call Text Webhook',
        activityType: 'CALL_WEBHOOK',
        config: {
          url: 'https://example.com/webhook',
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output.result).toBe('Success')
    })

    test('should fail CALL_WEBHOOK on HTTP error', async () => {
      ;(global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        headers: new Headers({ 'content-type': 'application/json' }),
        json: async () => ({ error: 'Not found' }),
      })

      const activity: ActivityDefinition = {
        activityId: 'activity-13',
        activityName: 'Failed Webhook',
        activityType: 'CALL_WEBHOOK',
        config: {
          url: 'https://example.com/not-found',
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('failed with status 404')
    })

    test('should fail CALL_WEBHOOK if missing url', async () => {
      const activity: ActivityDefinition = {
        activityId: 'activity-14',
        activityName: 'Invalid Webhook',
        activityType: 'CALL_WEBHOOK',
        config: {
          // Missing url
          body: {},
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('requires "url"')
    })
  })

  // ============================================================================
  // EXECUTE_FUNCTION Activity Tests
  // ============================================================================

  describe('EXECUTE_FUNCTION activity', () => {
    test('should execute EXECUTE_FUNCTION activity successfully', async () => {
      const mockFunction = jest.fn().mockResolvedValue({
        calculated: true,
        total: 150.5,
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const activity: ActivityDefinition = {
        activityId: 'activity-15',
        activityName: 'Calculate Total',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'calculateOrderTotal',
          args: {
            orderId: 'order-123',
            includeShipping: true,
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.output.executed).toBe(true)
      expect(result.output.result).toEqual({ calculated: true, total: 150.5 })
      expect(mockContainer.resolve).toHaveBeenCalledWith('workflowFunction:calculateOrderTotal')
      expect(mockFunction).toHaveBeenCalledWith(
        { orderId: 'order-123', includeShipping: true },
        mockContext
      )
    })

    test('should fail EXECUTE_FUNCTION if function not registered', async () => {
      mockContainer.resolve.mockImplementation(() => {
        throw new Error('workflowFunction:nonExistent not registered')
      })

      const activity: ActivityDefinition = {
        activityId: 'activity-16',
        activityName: 'Call Missing Function',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'nonExistent',
          args: {},
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not registered in DI container')
    })

    test('should fail EXECUTE_FUNCTION if missing functionName', async () => {
      const activity: ActivityDefinition = {
        activityId: 'activity-17',
        activityName: 'Invalid Function',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          // Missing functionName
          args: {},
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('requires "functionName"')
    })
  })

  // ============================================================================
  // Retry Logic Tests
  // ============================================================================

  describe('Retry logic', () => {
    test('should retry failed activity with exponential backoff', async () => {
      let attempt = 0
      const mockFunction = jest.fn().mockImplementation(() => {
        attempt++
        if (attempt < 3) {
          throw new Error('Temporary failure')
        }
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const activity: ActivityDefinition = {
        activityId: 'activity-18',
        activityName: 'Flaky Function',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'flakyFunction',
          args: {},
        },
        retryPolicy: {
          maxAttempts: 3,
          initialIntervalMs: 10,
          backoffCoefficient: 2,
          maxIntervalMs: 1000,
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(result.retryCount).toBe(2) // 0-indexed, so 2 means 3rd attempt
      expect(mockFunction).toHaveBeenCalledTimes(3)
    })

    test('should fail after exhausting all retry attempts', async () => {
      const mockFunction = jest.fn().mockRejectedValue(new Error('Persistent failure'))

      mockContainer.resolve.mockReturnValue(mockFunction)

      const activity: ActivityDefinition = {
        activityId: 'activity-19',
        activityName: 'Always Fails',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'alwaysFails',
          args: {},
        },
        retryPolicy: {
          maxAttempts: 3,
          initialIntervalMs: 5,
          backoffCoefficient: 2,
          maxIntervalMs: 1000,
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.retryCount).toBe(3)
      expect(result.error).toContain('failed after 3 attempts')
      expect(mockFunction).toHaveBeenCalledTimes(3)
    })

    test('should not retry if maxAttempts is 1', async () => {
      const mockFunction = jest.fn().mockRejectedValue(new Error('Immediate failure'))

      mockContainer.resolve.mockReturnValue(mockFunction)

      const activity: ActivityDefinition = {
        activityId: 'activity-20',
        activityName: 'No Retry',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'noRetry',
          args: {},
        },
        retryPolicy: {
          maxAttempts: 1,
          initialIntervalMs: 0,
          backoffCoefficient: 1,
          maxIntervalMs: 0,
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.retryCount).toBe(1)
      expect(mockFunction).toHaveBeenCalledTimes(1)
    })
  })

  // ============================================================================
  // Timeout Tests
  // ============================================================================

  describe('Timeout handling', () => {
    test('should timeout if activity takes too long', async () => {
      const mockFunction = jest.fn().mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 200))
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const activity: ActivityDefinition = {
        activityId: 'activity-21',
        activityName: 'Slow Function',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'slowFunction',
          args: {},
        },
        timeoutMs: 50, // Very short timeout
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('timeout after 50ms')
    })
  })

  // ============================================================================
  // Variable Interpolation Type Preservation Tests
  // ============================================================================

  describe('Variable interpolation type preservation', () => {
    test('should preserve array type for single variable interpolation', async () => {
      const mockFunction = jest.fn().mockImplementation((args) => {
        // Verify that the array is passed as-is, not converted to string
        expect(Array.isArray(args.items)).toBe(true)
        expect(args.items).toHaveLength(2)
        expect(args.items[0]).toEqual({ id: 1, name: 'Item 1' })
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const mockContextWithArray = {
        ...mockContext,
        workflowContext: {
          ...mockContext.workflowContext,
          itemsList: [
            { id: 1, name: 'Item 1' },
            { id: 2, name: 'Item 2' },
          ],
        },
      }

      const activity: ActivityDefinition = {
        activityId: 'activity-22',
        activityName: 'Test Array Preservation',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'testFunction',
          args: {
            items: '{{itemsList}}', // Single variable - should preserve array type
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContextWithArray
      )

      expect(result.success).toBe(true)
      expect(mockFunction).toHaveBeenCalled()
    })

    test('should preserve object type for single variable interpolation', async () => {
      const mockFunction = jest.fn().mockImplementation((args) => {
        // Verify that the object is passed as-is, not converted to string
        expect(typeof args.customer).toBe('object')
        expect(args.customer.name).toBe('John Doe')
        expect(args.customer.age).toBe(30)
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const mockContextWithObject = {
        ...mockContext,
        workflowContext: {
          ...mockContext.workflowContext,
          customerData: { name: 'John Doe', age: 30, email: 'john@example.com' },
        },
      }

      const activity: ActivityDefinition = {
        activityId: 'activity-23',
        activityName: 'Test Object Preservation',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'testFunction',
          args: {
            customer: '{{customerData}}', // Single variable - should preserve object type
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContextWithObject
      )

      expect(result.success).toBe(true)
      expect(mockFunction).toHaveBeenCalled()
    })

    test('should preserve number type for single variable interpolation', async () => {
      const mockFunction = jest.fn().mockImplementation((args) => {
        // Verify that the number is passed as-is, not converted to string
        expect(typeof args.total).toBe('number')
        expect(args.total).toBe(120.5)
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const mockContextWithNumber = {
        ...mockContext,
        workflowContext: {
          ...mockContext.workflowContext,
          orderTotal: 120.5,
        },
      }

      const activity: ActivityDefinition = {
        activityId: 'activity-24',
        activityName: 'Test Number Preservation',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'testFunction',
          args: {
            total: '{{orderTotal}}', // Single variable - should preserve number type
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContextWithNumber
      )

      expect(result.success).toBe(true)
      expect(mockFunction).toHaveBeenCalled()
    })

    test('should preserve boolean type for single variable interpolation', async () => {
      const mockFunction = jest.fn().mockImplementation((args) => {
        // Verify that the boolean is passed as-is, not converted to string
        expect(typeof args.isActive).toBe('boolean')
        expect(args.isActive).toBe(true)
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const mockContextWithBoolean = {
        ...mockContext,
        workflowContext: {
          ...mockContext.workflowContext,
          activeStatus: true,
        },
      }

      const activity: ActivityDefinition = {
        activityId: 'activity-25',
        activityName: 'Test Boolean Preservation',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'testFunction',
          args: {
            isActive: '{{activeStatus}}', // Single variable - should preserve boolean type
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContextWithBoolean
      )

      expect(result.success).toBe(true)
      expect(mockFunction).toHaveBeenCalled()
    })

    test('should return string for mixed variable interpolation', async () => {
      const mockFunction = jest.fn().mockImplementation((args) => {
        // Verify that mixed interpolation produces a string
        expect(typeof args.message).toBe('string')
        expect(args.message).toBe('Order order-123 has status confirmed')
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const mockContextWithStatus = {
        ...mockContext,
        workflowContext: {
          ...mockContext.workflowContext,
          status: 'confirmed',
        },
      }

      const activity: ActivityDefinition = {
        activityId: 'activity-26',
        activityName: 'Test Mixed Interpolation',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'testFunction',
          args: {
            message: 'Order {{orderId}} has status {{status}}', // Mixed interpolation - should be string
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContextWithStatus
      )

      expect(result.success).toBe(true)
      expect(mockFunction).toHaveBeenCalled()
    })

    test('should handle nested objects with mixed type interpolations', async () => {
      const mockFunction = jest.fn().mockImplementation((args) => {
        // Verify nested structure with mixed types
        expect(Array.isArray(args.data.items)).toBe(true)
        expect(args.data.items).toHaveLength(2)
        expect(typeof args.data.message).toBe('string')
        expect(args.data.message).toBe('Found 5 items')
        expect(args.data.description).toBe('Test')
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const mockContextWithMixed = {
        ...mockContext,
        workflowContext: {
          ...mockContext.workflowContext,
          lineItems: [{ id: 1 }, { id: 2 }],
          itemCount: 5,
          note: 'Test',
        },
      }

      const activity: ActivityDefinition = {
        activityId: 'activity-27',
        activityName: 'Test Nested Mixed Interpolation',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'testFunction',
          args: {
            data: {
              items: '{{lineItems}}', // Single var - preserves array
              message: 'Found {{itemCount}} items', // Mixed - becomes string
              description: '{{note}}', // Single var - preserves type (string)
            },
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContextWithMixed
      )

      expect(result.success).toBe(true)
      expect(mockFunction).toHaveBeenCalled()
    })

    test('should preserve workflow.version as number for single variable', async () => {
      const mockFunction = jest.fn().mockImplementation((args) => {
        // Verify that workflow.version is a number, not a string
        expect(typeof args.version).toBe('number')
        expect(args.version).toBe(1)
        return { success: true }
      })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const activity: ActivityDefinition = {
        activityId: 'activity-28',
        activityName: 'Test Workflow Version Type',
        activityType: 'EXECUTE_FUNCTION',
        config: {
          functionName: 'testFunction',
          args: {
            version: '{{workflow.version}}', // Single variable - should preserve number type
          },
        },
      }

      const result = await activityExecutor.executeActivity(
        mockEm,
        mockContainer,
        activity,
        mockContext
      )

      expect(result.success).toBe(true)
      expect(mockFunction).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // Multiple Activities Tests
  // ============================================================================

  describe('executeActivities', () => {
    test('should execute multiple activities in sequence', async () => {
      const mockEventBus = {
        emitEvent: jest.fn().mockResolvedValue(undefined),
      }

      const mockQueryEngine = {
        update: jest.fn().mockResolvedValue({ updated: 1 }),
      }

      mockContainer.resolve
        .mockReturnValueOnce(mockEventBus) // First activity
        .mockReturnValueOnce(mockQueryEngine) // Second activity

      const activities: ActivityDefinition[] = [
        {
          activityId: 'activity-29',
          activityName: 'Emit Event',
          activityType: 'EMIT_EVENT',
          config: {
            eventName: 'test.event',
            payload: { test: true },
          },
        },
        {
          activityId: 'activity-30',
          activityName: 'Update Entity',
          activityType: 'UPDATE_ENTITY',
          config: {
            entityType: 'orders',
            entityId: 'order-123',
            updates: { status: 'confirmed' },
          },
        },
      ]

      const results = await activityExecutor.executeActivities(
        mockEm,
        mockContainer,
        activities,
        mockContext
      )

      expect(results).toHaveLength(2)
      expect(results[0].success).toBe(true)
      expect(results[0].activityType).toBe('EMIT_EVENT')
      expect(results[1].success).toBe(true)
      expect(results[1].activityType).toBe('UPDATE_ENTITY')
    })

    test('should stop execution if activity fails (fail-fast)', async () => {
      const mockEventBus = {
        emitEvent: jest.fn().mockRejectedValue(new Error('Event bus error')),
      }

      const mockQueryEngine = {
        update: jest.fn().mockResolvedValue({ updated: 1 }),
      }

      mockContainer.resolve
        .mockReturnValueOnce(mockEventBus) // First activity (fails)
        .mockReturnValueOnce(mockQueryEngine) // Second activity (should not execute)

      const activities: ActivityDefinition[] = [
        {
          activityId: 'activity-31',
          activityName: 'Emit Event',
          activityType: 'EMIT_EVENT',
          config: {
            eventName: 'test.event',
            payload: {},
          },
        },
        {
          activityId: 'activity-32',
          activityName: 'Update Entity',
          activityType: 'UPDATE_ENTITY',
          config: {
            entityType: 'orders',
            entityId: 'order-123',
            updates: { status: 'confirmed' },
          },
        },
      ]

      const results = await activityExecutor.executeActivities(
        mockEm,
        mockContainer,
        activities,
        mockContext
      )

      // Only first activity executed (and failed)
      expect(results).toHaveLength(1)
      expect(results[0].success).toBe(false)
      expect(mockQueryEngine.update).not.toHaveBeenCalled()
    })

    test('should update workflow context with activity outputs', async () => {
      const mockFunction = jest.fn().mockResolvedValue({ calculated: 100 })

      mockContainer.resolve.mockReturnValue(mockFunction)

      const activities: ActivityDefinition[] = [
        {
          activityId: 'activity-33',
          activityName: 'Calculate',
          activityType: 'EXECUTE_FUNCTION',
          config: {
            functionName: 'calculate',
            args: {},
          },
        },
        {
          activityId: 'activity-34',
          activityName: 'Calculate Again',
          activityType: 'EXECUTE_FUNCTION',
          config: {
            functionName: 'calculate',
            args: {},
          },
        },
      ]

      await activityExecutor.executeActivities(mockEm, mockContainer, activities, mockContext)

      // Context should have outputs from both activities (keyed by activityName)
      expect(mockContext.workflowContext['Calculate']).toBeDefined()
      expect(mockContext.workflowContext['Calculate Again']).toBeDefined()
    })
  })
})
