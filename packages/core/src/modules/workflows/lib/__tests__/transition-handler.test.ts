/**
 * Transition Handler Unit Tests
 */

import { EntityManager } from '@mikro-orm/core'
import type { AwilixContainer } from 'awilix'
import {
  WorkflowInstance,
  WorkflowDefinition,
  WorkflowEvent,
} from '../../data/entities'
import * as transitionHandler from '../transition-handler'
import * as ruleEvaluator from '../../../business_rules/lib/rule-evaluator'
import * as ruleEngine from '../../../business_rules/lib/rule-engine'

// Mock dependencies
jest.mock('../../../business_rules/lib/rule-evaluator')
jest.mock('../../../business_rules/lib/rule-engine')

describe('Transition Handler (Unit Tests)', () => {
  let mockEm: jest.Mocked<EntityManager>
  let mockContainer: jest.Mocked<AwilixContainer>
  let mockInstance: WorkflowInstance
  let mockDefinition: WorkflowDefinition

  const testInstanceId = 'test-instance-id'
  const testDefinitionId = 'test-definition-id'
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

    // Create mock DI Container
    mockContainer = {
      resolve: jest.fn(),
    } as any

    // Create mock workflow instance
    mockInstance = {
      id: testInstanceId,
      definitionId: testDefinitionId,
      workflowId: 'simple-approval',
      currentStepId: 'step-1',
      status: 'RUNNING',
      context: { initiatedBy: 'user@example.com' },
      tenantId: testTenantId,
      organizationId: testOrgId,
      version: 1,
      startedAt: new Date(),
      retryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WorkflowInstance

    // Create mock workflow definition
    mockDefinition = {
      id: testDefinitionId,
      workflowId: 'simple-approval',
      workflowName: 'Simple Approval',
      version: 1,
      definition: {
        steps: [
          { stepId: 'start', stepName: 'Start', stepType: 'START' },
          { stepId: 'step-1', stepName: 'Step 1', stepType: 'AUTOMATED' },
          { stepId: 'step-2', stepName: 'Step 2', stepType: 'AUTOMATED' },
          { stepId: 'end', stepName: 'End', stepType: 'END' },
        ],
        transitions: [
          { fromStepId: 'start', toStepId: 'step-1' },
          { fromStepId: 'step-1', toStepId: 'step-2' },
          {
            fromStepId: 'step-2',
            toStepId: 'end',
            transitionId: 'step-2-to-end',
            transitionName: 'Complete',
          },
        ],
      },
      enabled: true,
      tenantId: testTenantId,
      organizationId: testOrgId,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as WorkflowDefinition

    // Reset mocks
    jest.clearAllMocks()

    // Set up default mock for ruleEvaluator.evaluateConditions
    ;(ruleEvaluator.evaluateConditions as jest.Mock).mockResolvedValue(true)
  })

  // ============================================================================
  // evaluateTransition Tests
  // ============================================================================

  describe('evaluateTransition', () => {
    test('should evaluate valid transition', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(result.isValid).toBe(true)
      expect(result.transition).toBeDefined()
      expect(result.transition.fromStepId).toBe('step-1')
      expect(result.transition.toStepId).toBe('step-2')
    })

    test('should return false if workflow definition not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('not found')
    })

    test('should return false if no transition exists from->to', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'step-1',
        'end', // No direct transition from step-1 to end
        { workflowContext: {} }
      )

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('No transition found')
    })

    test('should evaluate transition with inline condition', async () => {
      const definitionWithCondition = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              condition: {
                operator: 'equals',
                field: 'approved',
                value: true,
              },
            },
          ],
        },
      }

      mockEm.findOne.mockResolvedValue(definitionWithCondition as WorkflowDefinition)
      ;(ruleEvaluator.evaluateConditions as jest.Mock).mockResolvedValue(true)

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: { approved: true } }
      )

      expect(result.isValid).toBe(true)
      expect(ruleEvaluator.evaluateConditions).toHaveBeenCalled()
    })

    test('should return false when inline condition fails', async () => {
      const definitionWithCondition = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              condition: {
                operator: 'equals',
                field: 'approved',
                value: true,
              },
            },
          ],
        },
      }

      mockEm.findOne.mockResolvedValue(definitionWithCondition as WorkflowDefinition)
      ;(ruleEvaluator.evaluateConditions as jest.Mock).mockResolvedValue(false)

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: { approved: false } }
      )

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('evaluated to false')
    })

    test('should auto-select first valid transition when toStepId not provided', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'step-1',
        undefined, // No target step specified
        { workflowContext: {} }
      )

      expect(result.isValid).toBe(true)
      expect(result.transition).toBeDefined()
      expect(result.transition.fromStepId).toBe('step-1')
      expect(result.transition.toStepId).toBe('step-2')
    })

    test('should return false when no transitions available from step', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'non-existent-step',
        undefined,
        { workflowContext: {} }
      )

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('No transitions available')
    })

    test('should return false when no valid transitions found (all conditions fail)', async () => {
      const definitionWithConditions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              condition: { operator: 'equals', field: 'approved', value: true },
            },
            {
              fromStepId: 'step-1',
              toStepId: 'end',
              condition: { operator: 'equals', field: 'rejected', value: true },
            },
          ],
        },
      }

      mockEm.findOne.mockResolvedValue(definitionWithConditions as WorkflowDefinition)
      ;(ruleEvaluator.evaluateConditions as jest.Mock).mockResolvedValue(false)

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'step-1',
        undefined,
        { workflowContext: {} }
      )

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('No valid transitions found')
    })

    test('should handle evaluation errors gracefully', async () => {
      mockEm.findOne.mockRejectedValue(new Error('Database error'))

      const result = await transitionHandler.evaluateTransition(
        mockEm,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(result.isValid).toBe(false)
      expect(result.reason).toContain('evaluation error')
    })
  })

  // ============================================================================
  // findValidTransitions Tests
  // ============================================================================

  describe('findValidTransitions', () => {
    test('should find all valid transitions from a step', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const results = await transitionHandler.findValidTransitions(
        mockEm,
        mockInstance,
        'step-1',
        { workflowContext: {} }
      )

      expect(results).toHaveLength(1)
      expect(results[0].isValid).toBe(true)
      expect(results[0].transition?.toStepId).toBe('step-2')
    })

    test('should return empty array if workflow definition not found', async () => {
      mockEm.findOne.mockResolvedValue(null)

      const results = await transitionHandler.findValidTransitions(
        mockEm,
        mockInstance,
        'step-1',
        { workflowContext: {} }
      )

      expect(results).toEqual([])
    })

    test('should filter out invalid transitions (condition fails)', async () => {
      const definitionWithMultipleTransitions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              condition: { operator: 'equals', field: 'approved', value: true },
            },
            {
              fromStepId: 'step-1',
              toStepId: 'end',
              condition: { operator: 'equals', field: 'rejected', value: true },
            },
          ],
        },
      }

      mockEm.findOne.mockResolvedValue(definitionWithMultipleTransitions as WorkflowDefinition)

      // First call evaluates to true (approved), second call evaluates to false (rejected)
      ;(ruleEvaluator.evaluateConditions as jest.Mock)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false)

      const results = await transitionHandler.findValidTransitions(
        mockEm,
        mockInstance,
        'step-1',
        { workflowContext: { approved: true } }
      )

      expect(results).toHaveLength(2)
      expect(results[0].isValid).toBe(true)
      expect(results[1].isValid).toBe(false)
    })

    test('should return empty array if no transitions from step', async () => {
      mockEm.findOne.mockResolvedValue(mockDefinition)

      const results = await transitionHandler.findValidTransitions(
        mockEm,
        mockInstance,
        'non-existent-step',
        { workflowContext: {} }
      )

      expect(results).toEqual([])
    })

    test('should handle errors gracefully', async () => {
      mockEm.findOne.mockRejectedValue(new Error('Database error'))

      const results = await transitionHandler.findValidTransitions(
        mockEm,
        mockInstance,
        'step-1',
        { workflowContext: {} }
      )

      expect(results).toEqual([])
    })
  })

  // ============================================================================
  // executeTransition Tests
  // ============================================================================

  describe('executeTransition', () => {
    test('should execute valid transition successfully', async () => {
      mockEm.findOne.mockReset()
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition) // 1. evaluateTransition
        .mockResolvedValueOnce(mockDefinition) // 2. evaluatePreConditions
        .mockResolvedValueOnce(mockDefinition) // 3. evaluatePostConditions
        .mockResolvedValueOnce(mockDefinition) // 4. Additional call
        .mockResolvedValueOnce(mockDefinition) // 5. Additional call
        .mockResolvedValue(mockDefinition) // Fallback for any additional calls

      ;(ruleEngine.executeRules as jest.Mock)
        .mockResolvedValueOnce({
          allowed: true,
          executedRules: [],
          totalExecutionTime: 10,
        })
        .mockResolvedValueOnce({
          allowed: true,
          executedRules: [],
          totalExecutionTime: 5,
        })

      mockEm.create.mockReturnValue({} as any)

      const result = await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(result.success).toBe(true)
      expect(result.nextStepId).toBe('step-2')
      expect(result.conditionsEvaluated?.preConditions).toBe(true)
      expect(result.conditionsEvaluated?.postConditions).toBe(true)
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should reject transition if evaluation fails', async () => {
      mockEm.findOne.mockResolvedValue(null) // Definition not found

      const result = await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    test('should reject transition if pre-conditions fail', async () => {
      // Create a definition with preConditions
      const definitionWithPreConditions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            { fromStepId: 'start', toStepId: 'step-1' },
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              preConditions: [{ ruleId: 'test-guard-rule', required: true }],
            },
            { fromStepId: 'step-2', toStepId: 'end' },
          ],
        },
      }

      mockEm.findOne
        .mockResolvedValueOnce(definitionWithPreConditions) // evaluateTransition
        .mockResolvedValueOnce(definitionWithPreConditions) // evaluatePreConditions

      ;(ruleEngine.executeRuleByRuleId as jest.Mock).mockResolvedValueOnce({
        success: false,
        ruleId: 'test-guard-rule',
        ruleName: 'Test Guard Rule',
        conditionResult: false,
        actionsExecuted: null,
        executionTime: 10,
        error: undefined,
      })

      mockEm.create.mockReturnValue({} as any)

      const result = await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('Pre-conditions failed')
      expect(result.conditionsEvaluated?.preConditions).toBe(false)
      expect(mockEm.persistAndFlush).toHaveBeenCalled() // Rejection event logged
    })

    test('should log transition rejection event', async () => {
      // Create a definition with preConditions
      const definitionWithPreConditions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            { fromStepId: 'start', toStepId: 'step-1' },
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              preConditions: [{ ruleId: 'test-guard-rule', required: true }],
            },
            { fromStepId: 'step-2', toStepId: 'end' },
          ],
        },
      }

      mockEm.findOne
        .mockResolvedValueOnce(definitionWithPreConditions)
        .mockResolvedValueOnce(definitionWithPreConditions)

      ;(ruleEngine.executeRuleByRuleId as jest.Mock).mockResolvedValueOnce({
        success: false,
        ruleId: 'test-guard-rule',
        ruleName: 'Test Guard Rule',
        conditionResult: false,
        actionsExecuted: null,
        executionTime: 10,
        error: undefined,
      })

      mockEm.create.mockReturnValue({} as any)

      await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {}, userId: 'user-123' }
      )

      expect(mockEm.create).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          eventType: 'TRANSITION_REJECTED',
          eventData: expect.objectContaining({
            fromStepId: 'step-1',
            toStepId: 'step-2',
            reason: 'Pre-conditions failed',
          }),
        })
      )
    })

    test('should execute transition even if post-conditions fail (warning only)', async () => {
      // Create a definition with postConditions
      const definitionWithPostConditions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            { fromStepId: 'start', toStepId: 'step-1' },
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              postConditions: [{ ruleId: 'test-post-rule', required: true }],
            },
            { fromStepId: 'step-2', toStepId: 'end' },
          ],
        },
      }

      mockEm.findOne.mockReset()
      mockEm.findOne.mockResolvedValue(definitionWithPostConditions)

      // Post-condition fails
      ;(ruleEngine.executeRuleByRuleId as jest.Mock).mockResolvedValueOnce({
        success: false,
        ruleId: 'test-post-rule',
        ruleName: 'Test Post Rule',
        conditionResult: false,
        actionsExecuted: null,
        executionTime: 5,
        error: undefined,
      })

      mockEm.create.mockReturnValue({} as any)

      const result = await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      // Transition should succeed despite post-condition failure
      expect(result.success).toBe(true)
      expect(result.nextStepId).toBe('step-2')
      expect(result.conditionsEvaluated?.postConditions).toBe(false)
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should log successful transition event', async () => {
      mockEm.findOne.mockReset()
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValue(mockDefinition)

      ;(ruleEngine.executeRules as jest.Mock)
        .mockResolvedValueOnce({
          allowed: true,
          executedRules: [],
          totalExecutionTime: 10,
        })
        .mockResolvedValueOnce({
          allowed: true,
          executedRules: [],
          totalExecutionTime: 5,
        })

      mockEm.create.mockReturnValue({} as any)

      await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-2',
        'end',
        { workflowContext: {}, userId: 'user-123' }
      )

      expect(mockEm.create).toHaveBeenCalledWith(
        WorkflowEvent,
        expect.objectContaining({
          eventType: 'TRANSITION_EXECUTED',
          eventData: expect.objectContaining({
            fromStepId: 'step-2',
            toStepId: 'end',
            transitionId: 'step-2-to-end',
            transitionName: 'Complete',
            preConditionsPassed: true,
            postConditionsPassed: true,
          }),
        })
      )
    })

    test('should update workflow instance currentStepId', async () => {
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce(mockDefinition)

      ;(ruleEngine.executeRules as jest.Mock)
        .mockResolvedValueOnce({
          allowed: true,
          executedRules: [],
          totalExecutionTime: 10,
        })
        .mockResolvedValueOnce({
          allowed: true,
          executedRules: [],
          totalExecutionTime: 5,
        })

      mockEm.create.mockReturnValue({} as any)

      await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(mockInstance.currentStepId).toBe('step-2')
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should update workflow context', async () => {
      mockEm.findOne
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce(mockDefinition)
        .mockResolvedValueOnce(mockDefinition)

      ;(ruleEngine.executeRules as jest.Mock)
        .mockResolvedValueOnce({
          allowed: true,
          executedRules: [],
          totalExecutionTime: 10,
        })
        .mockResolvedValueOnce({
          allowed: true,
          executedRules: [],
          totalExecutionTime: 5,
        })

      mockEm.create.mockReturnValue({} as any)

      await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: { newField: 'value' } }
      )

      expect(mockInstance.context).toEqual({
        initiatedBy: 'user@example.com',
        newField: 'value',
      })
      expect(mockEm.flush).toHaveBeenCalled()
    })

    test('should handle execution errors gracefully', async () => {
      mockEm.findOne.mockRejectedValue(new Error('Database error'))

      const result = await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(result.success).toBe(false)
      expect(result.error).toContain('evaluation error')
      // Note: No event is logged when evaluation fails early
    })
  })

  // ============================================================================
  // Business Rules Integration Tests
  // ============================================================================

  describe('Business Rules Integration', () => {
    test('should call rule engine for pre-conditions with correct entityType', async () => {
      // Create a definition with preConditions
      const definitionWithPreConditions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            { fromStepId: 'start', toStepId: 'step-1' },
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              preConditions: [{ ruleId: 'test-guard-rule', required: true }],
            },
            { fromStepId: 'step-2', toStepId: 'end' },
          ],
        },
      }

      mockEm.findOne.mockResolvedValue(definitionWithPreConditions)

      ;(ruleEngine.executeRuleByRuleId as jest.Mock).mockResolvedValueOnce({
        success: true,
        ruleId: 'test-guard-rule',
        ruleName: 'Test Guard Rule',
        conditionResult: true,
        actionsExecuted: null,
        executionTime: 10,
      })

      mockEm.create.mockReturnValue({} as any)

      await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      expect(ruleEngine.executeRuleByRuleId).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          ruleId: 'test-guard-rule',
          entityType: 'workflow:simple-approval:transition',
          eventType: 'pre_transition',
          data: expect.objectContaining({
            fromStepId: 'step-1',
            toStepId: 'step-2',
          }),
        })
      )
    })

    test('should call rule engine for post-conditions with correct eventType', async () => {
      // Create a definition with postConditions
      const definitionWithPostConditions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            { fromStepId: 'start', toStepId: 'step-1' },
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              postConditions: [{ ruleId: 'test-post-rule', required: true }],
            },
            { fromStepId: 'step-2', toStepId: 'end' },
          ],
        },
      }

      mockEm.findOne.mockReset()
      mockEm.findOne.mockResolvedValue(definitionWithPostConditions)

      ;(ruleEngine.executeRuleByRuleId as jest.Mock).mockResolvedValueOnce({
        success: true,
        ruleId: 'test-post-rule',
        ruleName: 'Test Post Rule',
        conditionResult: true,
        actionsExecuted: null,
        executionTime: 5,
      })

      mockEm.create.mockReturnValue({} as any)

      await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        { workflowContext: {} }
      )

      // Check call to executeRuleByRuleId for post-conditions
      expect(ruleEngine.executeRuleByRuleId).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          ruleId: 'test-post-rule',
          entityType: 'workflow:simple-approval:transition',
          eventType: 'post_transition',
        })
      )
    })

    test('should pass workflow context and trigger data to rule engine', async () => {
      // Create a definition with preConditions
      const definitionWithPreConditions = {
        ...mockDefinition,
        definition: {
          ...mockDefinition.definition,
          transitions: [
            { fromStepId: 'start', toStepId: 'step-1' },
            {
              fromStepId: 'step-1',
              toStepId: 'step-2',
              preConditions: [{ ruleId: 'test-guard-rule', required: true }],
            },
            { fromStepId: 'step-2', toStepId: 'end' },
          ],
        },
      }

      mockEm.findOne.mockResolvedValue(definitionWithPreConditions)

      ;(ruleEngine.executeRuleByRuleId as jest.Mock).mockResolvedValueOnce({
        success: true,
        ruleId: 'test-guard-rule',
        ruleName: 'Test Guard Rule',
        conditionResult: true,
        actionsExecuted: null,
        executionTime: 10,
      })

      mockEm.create.mockReturnValue({} as any)

      const contextData = { approved: true, comment: 'Looks good' }
      const triggerData = { source: 'api' }

      await transitionHandler.executeTransition(
        mockEm,
        mockContainer,
        mockInstance,
        'step-1',
        'step-2',
        {
          workflowContext: contextData,
          triggerData,
          userId: 'user-123',
        }
      )

      expect(ruleEngine.executeRuleByRuleId).toHaveBeenCalledWith(
        mockEm,
        expect.objectContaining({
          data: expect.objectContaining({
            workflowContext: expect.objectContaining(contextData),
            triggerData,
          }),
          executedBy: 'user-123',
        })
      )
    })
  })
})
