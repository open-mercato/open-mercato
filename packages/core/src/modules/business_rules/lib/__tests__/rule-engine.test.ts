import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import * as ruleEngine from '../rule-engine'
import * as ruleEvaluator from '../rule-evaluator'
import * as actionExecutor from '../action-executor'
import type { RuleEngineContext } from '../rule-engine'
import type { ActionExecutionOutcome } from '../action-executor'
import type { BusinessRule } from '../../data/entities'

// Mock dependencies
jest.mock('../rule-evaluator')
jest.mock('../action-executor')

describe('Rule Engine (Unit Tests)', () => {
  let mockEm: jest.Mocked<EntityManager>

  const testTenantId = '00000000-0000-4000-8000-000000000001'
  const testOrgId = '00000000-0000-4000-8000-000000000002'
  const testEntityId = '00000000-0000-4000-8000-000000000003'
  const allowOutcome: ActionExecutionOutcome = {
    success: true,
    results: [
      {
        action: { type: 'ALLOW_TRANSITION' },
        success: true,
        result: { type: 'ALLOW_TRANSITION', allowed: true, message: 'Allowed' },
        executionTime: 1,
      },
    ],
    totalTime: 1,
  }
  const blockOutcome: ActionExecutionOutcome = {
    success: false,
    results: [
      {
        action: { type: 'BLOCK_TRANSITION' },
        success: true,
        result: { type: 'BLOCK_TRANSITION', allowed: false, message: 'Blocked' },
        executionTime: 1,
      },
    ],
    totalTime: 1,
  }

  beforeEach(() => {
    // Create mock EntityManager
    mockEm = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn(),
      persistAndFlush: jest.fn(),
      nativeDelete: jest.fn(),
    } as any

    // Reset all mocks
    jest.clearAllMocks()
  })

  describe('findApplicableRules', () => {
    test('should find rules by entity type', async () => {
      const mockRule: Partial<BusinessRule> = {
        id: 'rule-1',
        ruleId: 'TEST-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        enabled: true,
        priority: 100,
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.find.mockResolvedValue([mockRule as BusinessRule])

      const rules = await ruleEngine.findApplicableRules(mockEm, {
        entityType: 'WorkOrder',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(rules).toHaveLength(1)
      expect(rules[0].ruleId).toBe('TEST-001')
      expect(mockEm.find).toHaveBeenCalledWith(
        expect.any(Function), // BusinessRule class
        expect.objectContaining({
          entityType: 'WorkOrder',
          tenantId: testTenantId,
          organizationId: testOrgId,
          enabled: true,
          deletedAt: null,
        }),
        expect.objectContaining({
          orderBy: expect.objectContaining({ priority: 'DESC' })
        })
      )
    })

    test('should filter by event type when provided', async () => {
      const mockRule: Partial<BusinessRule> = {
        id: 'rule-1',
        ruleId: 'TEST-001',
        ruleName: 'Before Status Change',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeStatusChange',
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.find.mockResolvedValue([mockRule as BusinessRule])

      const rules = await ruleEngine.findApplicableRules(mockEm, {
        entityType: 'WorkOrder',
        eventType: 'beforeStatusChange',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(rules).toHaveLength(1)
      expect(rules[0].eventType).toBe('beforeStatusChange')
    })

    test('should return empty array when no rules match', async () => {
      mockEm.find.mockResolvedValue([])

      const rules = await ruleEngine.findApplicableRules(mockEm, {
        entityType: 'NonExistent',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(rules).toHaveLength(0)
    })

    test('should sort rules by priority descending', async () => {
      const mockRules: Partial<BusinessRule>[] = [
        {
          id: 'rule-1',
          ruleId: 'TEST-001',
          ruleName: 'Low Priority',
          priority: 50,
          entityType: 'WorkOrder',
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
        {
          id: 'rule-2',
          ruleId: 'TEST-002',
          ruleName: 'High Priority',
          priority: 100,
          entityType: 'WorkOrder',
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
      ]

      mockEm.find.mockResolvedValue(mockRules as BusinessRule[])

      await ruleEngine.findApplicableRules(mockEm, {
        entityType: 'WorkOrder',
        tenantId: testTenantId,
        organizationId: testOrgId,
      })

      expect(mockEm.find).toHaveBeenCalledWith(
        expect.any(Function), // BusinessRule class
        expect.any(Object),
        expect.objectContaining({
          orderBy: expect.objectContaining({
            priority: 'DESC',
            ruleId: 'ASC'
          })
        })
      )
    })
  })

  describe('executeSingleRule', () => {
    const mockRule: Partial<BusinessRule> = {
      id: 'rule-1',
      ruleId: 'TEST-001',
      ruleName: 'Status Check',
      ruleType: 'GUARD',
      entityType: 'WorkOrder',
      conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
      successActions: [{ type: 'ALLOW_TRANSITION' }],
      failureActions: [{ type: 'BLOCK_TRANSITION' }],
      enabled: true,
      tenantId: testTenantId,
      organizationId: testOrgId,
    }

    test('should execute rule with passing condition', async () => {
      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      // Mock evaluateSingleRule to return passing result
      jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
        rule: mockRule as BusinessRule,
        conditionsPassed: true,
        evaluationCompleted: true,
        evaluationTime: 1,
      })

      // Mock action execution
      jest.mocked(actionExecutor.executeActions).mockResolvedValue(allowOutcome)

      const result = await ruleEngine.executeSingleRule(mockEm, mockRule as BusinessRule, context)

      expect(result.conditionResult).toBe(true)
      expect(result.actionsExecuted).not.toBeNull()
      expect(result.actionsExecuted?.success).toBe(true)
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
      expect(ruleEvaluator.evaluateSingleRule).toHaveBeenCalledWith(
        mockRule,
        context.data,
        expect.objectContaining({
          entityType: context.entityType,
          entityId: context.entityId,
        })
      )
      expect(actionExecutor.executeActions).toHaveBeenCalledWith(
        mockRule.successActions,
        expect.any(Object)
      )
    })

    test('should execute rule with failing condition', async () => {
      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'DRAFT' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      // Mock evaluateSingleRule to return failing result
      jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
        rule: mockRule as BusinessRule,
        conditionsPassed: false,
        evaluationCompleted: true,
        evaluationTime: 1,
      })

      // Mock failure action execution
      jest.mocked(actionExecutor.executeActions).mockResolvedValue(blockOutcome)

      const result = await ruleEngine.executeSingleRule(mockEm, mockRule as BusinessRule, context)

      expect(result.conditionResult).toBe(false)
      expect(result.actionsExecuted).not.toBeNull()
      expect(result.actionsExecuted?.success).toBe(false)
      expect(actionExecutor.executeActions).toHaveBeenCalledWith(
        mockRule.failureActions,
        expect.any(Object)
      )
    })

    test('should handle condition evaluation errors', async () => {
      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      // Mock evaluateSingleRule to return error
      jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
        rule: mockRule as BusinessRule,
        conditionsPassed: false,
        evaluationCompleted: false,
        evaluationTime: 1,
        error: 'Invalid condition',
      })

      const result = await ruleEngine.executeSingleRule(mockEm, mockRule as BusinessRule, context)

      expect(result.error).toBeDefined()
      expect(result.error).toBe('Invalid condition')
    })

    test('should handle action execution errors', async () => {
      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
        rule: mockRule as BusinessRule,
        conditionsPassed: true,
        evaluationCompleted: true,
        evaluationTime: 1,
      })

      jest.mocked(actionExecutor.executeActions).mockRejectedValue(
        new Error('Action failed')
      )

      const result = await ruleEngine.executeSingleRule(mockEm, mockRule as BusinessRule, context)

      expect(result.error).toBeDefined()
      expect(result.error).toContain('Action failed')
    })
  })

  describe('executeRules', () => {
    test('should execute multiple rules in priority order', async () => {
      const mockRules: Partial<BusinessRule>[] = [
        {
          id: 'rule-1',
          ruleId: 'TEST-001',
          ruleName: 'High Priority',
          ruleType: 'GUARD',
          priority: 100,
          entityType: 'WorkOrder',
          conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
          successActions: [],
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
        {
          id: 'rule-2',
          ruleId: 'TEST-002',
          ruleName: 'Low Priority',
          ruleType: 'ACTION',
          priority: 50,
          entityType: 'WorkOrder',
          conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
          successActions: [],
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
      ]

      mockEm.find.mockResolvedValue(mockRules as BusinessRule[])

      // Mock both rules to pass
      jest.mocked(ruleEvaluator.evaluateSingleRule)
        .mockResolvedValueOnce({
          rule: mockRules[0] as BusinessRule,
          conditionsPassed: true,
          evaluationCompleted: true,
          evaluationTime: 1,
        })
        .mockResolvedValueOnce({
          rule: mockRules[1] as BusinessRule,
          conditionsPassed: true,
          evaluationCompleted: true,
          evaluationTime: 1,
        })

      jest.mocked(actionExecutor.executeActions).mockResolvedValue({
        success: true,
        results: [],
        totalTime: 1,
      })

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(mockEm, context)

      expect(result.executedRules).toHaveLength(2)
      expect(result.executedRules[0].rule.ruleId).toBe('TEST-001')
      expect(result.executedRules[1].rule.ruleId).toBe('TEST-002')
      expect(result.allowed).toBe(true)
    })

    test('should block operation when GUARD rule blocks', async () => {
      const mockRule: Partial<BusinessRule> = {
        id: 'rule-1',
        ruleId: 'TEST-001',
        ruleName: 'Status Guard',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        failureActions: [{ type: 'BLOCK_TRANSITION' }],
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.find.mockResolvedValue([mockRule as BusinessRule])

      // Mock GUARD rule to fail (conditions not passed)
      jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
        rule: mockRule as BusinessRule,
        conditionsPassed: false,
        evaluationCompleted: true,
        evaluationTime: 1,
      })

      jest.mocked(actionExecutor.executeActions).mockResolvedValue(blockOutcome)

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'DRAFT' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(mockEm, context)

      expect(result.allowed).toBe(false)
      expect(result.executedRules).toHaveLength(1)
    })

    test('should allow operation when all GUARD rules pass', async () => {
      const mockRules: Partial<BusinessRule>[] = [
        {
          id: 'rule-1',
          ruleId: 'TEST-001',
          ruleName: 'Status Guard',
          ruleType: 'GUARD',
          entityType: 'WorkOrder',
          conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
          successActions: [],
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
        {
          id: 'rule-2',
          ruleId: 'TEST-002',
          ruleName: 'Priority Guard',
          ruleType: 'GUARD',
          entityType: 'WorkOrder',
          conditionExpression: { field: 'priority', operator: '=', value: 'HIGH' },
          successActions: [],
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
      ]

      mockEm.find.mockResolvedValue(mockRules as BusinessRule[])

      // Mock both GUARD rules to pass
      jest.mocked(ruleEvaluator.evaluateSingleRule)
        .mockResolvedValueOnce({
          rule: mockRules[0] as BusinessRule,
          conditionsPassed: true,
          evaluationCompleted: true,
          evaluationTime: 1,
        })
        .mockResolvedValueOnce({
          rule: mockRules[1] as BusinessRule,
          conditionsPassed: true,
          evaluationCompleted: true,
          evaluationTime: 1,
        })

      jest.mocked(actionExecutor.executeActions).mockResolvedValue({
        success: true,
        results: [],
        totalTime: 1,
      })

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED', priority: 'HIGH' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(mockEm, context)

      expect(result.allowed).toBe(true)
      expect(result.executedRules).toHaveLength(2)
      expect(result.executedRules.every((r) => r.conditionResult)).toBe(true)
    })

    test('should continue execution if non-GUARD rule fails', async () => {
      const mockRules: Partial<BusinessRule>[] = [
        {
          id: 'rule-1',
          ruleId: 'TEST-001',
          ruleName: 'Valid Rule',
          ruleType: 'ACTION',
          entityType: 'WorkOrder',
          conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
          successActions: [],
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
        {
          id: 'rule-2',
          ruleId: 'TEST-002',
          ruleName: 'Another Rule',
          ruleType: 'ACTION',
          entityType: 'WorkOrder',
          conditionExpression: { field: 'priority', operator: '=', value: 'HIGH' },
          successActions: [],
          enabled: true,
          tenantId: testTenantId,
          organizationId: testOrgId,
        },
      ]

      mockEm.find.mockResolvedValue(mockRules as BusinessRule[])

      // First rule passes, second fails
      jest.mocked(ruleEvaluator.evaluateSingleRule)
        .mockResolvedValueOnce({
          rule: mockRules[0] as BusinessRule,
          conditionsPassed: true,
          evaluationCompleted: true,
          evaluationTime: 1,
        })
        .mockResolvedValueOnce({
          rule: mockRules[1] as BusinessRule,
          conditionsPassed: false,
          evaluationCompleted: true,
          evaluationTime: 1,
        })

      jest.mocked(actionExecutor.executeActions).mockResolvedValue({
        success: true,
        results: [],
        totalTime: 1,
      })

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED', priority: 'LOW' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(mockEm, context)

      expect(result.executedRules).toHaveLength(2)
      expect(result.executedRules[0].conditionResult).toBe(true)
      expect(result.executedRules[1].conditionResult).toBe(false)
      expect(result.allowed).toBe(true)
    })

    test('should return validation error for invalid context', async () => {
      const invalidContext = {
        // Missing required fields
        data: { status: 'RELEASED' },
      } as any

      const result = await ruleEngine.executeRules(mockEm, invalidContext)

      expect(result.allowed).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors!.length).toBeGreaterThan(0)
    })

    test('should return execution metrics', async () => {
      const mockRule: Partial<BusinessRule> = {
        id: 'rule-1',
        ruleId: 'TEST-001',
        ruleName: 'Test Rule',
        ruleType: 'ACTION',
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        successActions: [],
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      mockEm.find.mockResolvedValue([mockRule as BusinessRule])

      jest.mocked(ruleEvaluator.evaluateSingleRule).mockResolvedValue({
        rule: mockRule as BusinessRule,
        conditionsPassed: true,
        evaluationCompleted: true,
        evaluationTime: 5,
      })

      jest.mocked(actionExecutor.executeActions).mockResolvedValue({
        success: true,
        results: [],
        totalTime: 5,
      })

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(mockEm, context)

      expect(result.totalExecutionTime).toBeGreaterThanOrEqual(0)
      expect(result.executedRules[0].executionTime).toBeGreaterThanOrEqual(0)
    })

    test('should handle rule count limit', async () => {
      // Create more than MAX_RULES_PER_EXECUTION (100) rules
      const manyRules = Array.from({ length: 101 }, (_, i) => ({
        id: `rule-${i}`,
        ruleId: `TEST-${String(i).padStart(3, '0')}`,
        ruleName: `Rule ${i}`,
        ruleType: 'ACTION' as const,
        entityType: 'WorkOrder',
        conditionExpression: { field: 'status', operator: '=', value: 'RELEASED' },
        enabled: true,
        tenantId: testTenantId,
        organizationId: testOrgId,
      }))

      mockEm.find.mockResolvedValue(manyRules as BusinessRule[])

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
        dryRun: true,
      }

      const result = await ruleEngine.executeRules(mockEm, context)

      expect(result.allowed).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors![0]).toContain('Rule count limit exceeded')
    })
  })

  describe('logRuleExecution', () => {
    test('should create execution log with success result', async () => {
      const mockRule: Partial<BusinessRule> = {
        id: 'rule-1',
        ruleId: 'TEST-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'RELEASED' },
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      const mockLog = {
        id: 'log-1',
        executionResult: 'SUCCESS',
        executionTimeMs: 42,
      }

      mockEm.create.mockReturnValue(mockLog as any)
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const logId = await ruleEngine.logRuleExecution(mockEm, {
        rule: mockRule as BusinessRule,
        context,
        conditionResult: true,
        actionsExecuted: null,
        executionTime: 42,
      })

      expect(logId).toBe('log-1')
      expect(mockEm.create).toHaveBeenCalledWith(
        expect.any(Function), // RuleExecutionLog class
        expect.objectContaining({
          executionResult: 'SUCCESS',
          executionTimeMs: 42,
        })
      )
      expect(mockEm.persistAndFlush).toHaveBeenCalled()
    })

    test('should create execution log with error result', async () => {
      const mockRule: Partial<BusinessRule> = {
        id: 'rule-1',
        ruleId: 'TEST-001',
        ruleName: 'Test Rule',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      const context: RuleEngineContext = {
        entityType: 'WorkOrder',
        entityId: testEntityId,
        data: { status: 'DRAFT' },
        tenantId: testTenantId,
        organizationId: testOrgId,
      }

      const mockLog = {
        id: 'log-2',
        executionResult: 'ERROR',
        errorMessage: 'Condition failed',
      }

      mockEm.create.mockReturnValue(mockLog as any)
      mockEm.persistAndFlush.mockResolvedValue(undefined)

      const logId = await ruleEngine.logRuleExecution(mockEm, {
        rule: mockRule as BusinessRule,
        context,
        conditionResult: false,
        actionsExecuted: null,
        executionTime: 42,
        error: 'Condition failed',
      })

      expect(logId).toBe('log-2')
      expect(mockEm.create).toHaveBeenCalledWith(
        expect.any(Function), // RuleExecutionLog class
        expect.objectContaining({
          executionResult: 'ERROR',
          errorMessage: 'Condition failed',
        })
      )
    })
  })
})
