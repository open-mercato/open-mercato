import { describe, test, expect } from '@jest/globals'
import {
  evaluate,
  evaluateSingleRule,
  evaluateConditions,
  sortRulesByPriority,
  filterRulesByContext,
  getApplicableRules,
  type RuleEvaluationContext,
} from '../rule-evaluator'
import type { BusinessRule } from '../../data/entities'

describe('RuleEvaluatorService', () => {

  // Helper to create test rules
  const createTestRule = (overrides: Partial<BusinessRule> = {}): BusinessRule => {
    return {
      id: 'test-id',
      ruleId: 'TEST-001',
      ruleName: 'Test Rule',
      ruleType: 'GUARD',
      entityType: 'WorkOrder',
      conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
      enabled: true,
      priority: 100,
      version: 1,
      tenantId: 'tenant-123',
      organizationId: 'org-456',
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    } as BusinessRule
  }

  describe('evaluateSingleRule', () => {
    test('should evaluate a simple rule successfully', async () => {
      const rule = createTestRule({
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
      })

      const result = await evaluateSingleRule(rule, { status: 'ACTIVE' }, {})

      expect(result.success).toBe(true)
      expect(result.rule).toBe(rule)
      expect(result.evaluationTime).toBeGreaterThanOrEqual(0)
      expect(result.error).toBeUndefined()
    })

    test('should fail when conditions do not match', async () => {
      const rule = createTestRule({
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
      })

      const result = await evaluateSingleRule(rule, { status: 'INACTIVE' }, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeUndefined()
    })

    test('should fail when rule is disabled', async () => {
      const rule = createTestRule({
        enabled: false,
      })

      const result = await evaluateSingleRule(rule, { status: 'ACTIVE' }, {})

      expect(result.success).toBe(false)
      expect(result.error).toBe('Rule is disabled')
    })

    test('should fail when rule is not yet effective', async () => {
      const future = new Date(Date.now() + 86400000) // Tomorrow
      const rule = createTestRule({
        effectiveFrom: future,
      })

      const result = await evaluateSingleRule(rule, { status: 'ACTIVE' }, {})

      expect(result.success).toBe(false)
      expect(result.error).toBe('Rule is not effective (outside date range)')
    })

    test('should fail when rule has expired', async () => {
      const past = new Date(Date.now() - 86400000) // Yesterday
      const rule = createTestRule({
        effectiveTo: past,
      })

      const result = await evaluateSingleRule(rule, { status: 'ACTIVE' }, {})

      expect(result.success).toBe(false)
      expect(result.error).toBe('Rule is not effective (outside date range)')
    })

    test('should succeed when rule is within effective date range', async () => {
      const yesterday = new Date(Date.now() - 86400000)
      const tomorrow = new Date(Date.now() + 86400000)
      const rule = createTestRule({
        effectiveFrom: yesterday,
        effectiveTo: tomorrow,
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
      })

      const result = await evaluateSingleRule(rule, { status: 'ACTIVE' }, {})

      expect(result.success).toBe(true)
    })

    test('should handle complex AND conditions', async () => {
      const rule = createTestRule({
        conditionExpression: {
          operator: 'AND',
          rules: [
            { field: 'quantity', operator: '>', value: 0 },
            { field: 'status', operator: '=', value: 'ACTIVE' },
          ],
        },
      })

      const result = await evaluateSingleRule(rule, { quantity: 10, status: 'ACTIVE' }, {})

      expect(result.success).toBe(true)
    })

    test('should handle complex OR conditions', async () => {
      const rule = createTestRule({
        conditionExpression: {
          operator: 'OR',
          rules: [
            { field: 'priority', operator: '=', value: 'HIGH' },
            { field: 'urgent', operator: '=', value: true },
          ],
        },
      })

      const result = await evaluateSingleRule(rule, { priority: 'LOW', urgent: true }, {})

      expect(result.success).toBe(true)
    })

    test('should pass when conditions are null (always true)', async () => {
      const rule = createTestRule({
        conditionExpression: null as any,
      })

      const result = await evaluateSingleRule(rule, {}, {})

      expect(result.success).toBe(true)
    })

    test('should handle evaluation errors gracefully', async () => {
      const rule = createTestRule({
        conditionExpression: { field: 'value', operator: 'INVALID_OPERATOR' as any, value: 10 },
      })

      const result = await evaluateSingleRule(rule, { value: 10 }, {})

      expect(result.success).toBe(false)
      expect(result.error).toContain('Unknown operator')
    })
  })

  describe('evaluateConditions', () => {
    test('should evaluate simple conditions', async () => {
      const conditions = { field: 'status', operator: '=', value: 'ACTIVE' }
      const result = await evaluateConditions(conditions, { status: 'ACTIVE' }, {})

      expect(result).toBe(true)
    })

    test('should evaluate group conditions', async () => {
      const conditions = {
        operator: 'AND',
        rules: [
          { field: 'quantity', operator: '>', value: 0 },
          { field: 'price', operator: '<=', value: 100 },
        ],
      }
      const result = await evaluateConditions(conditions, { quantity: 10, price: 50 }, {})

      expect(result).toBe(true)
    })

    test('should return true when conditions are null', async () => {
      const result = await evaluateConditions(null, {}, {})

      expect(result).toBe(true)
    })

    test('should throw error on invalid conditions', async () => {
      const conditions = { field: 'value', operator: 'INVALID' as any, value: 10 }

      await expect(evaluateConditions(conditions, { value: 10 }, {})).rejects.toThrow('Condition evaluation failed')
    })
  })

  describe('evaluate (multiple rules)', () => {
    test('should evaluate multiple rules and return results', async () => {
      const rules = [
        createTestRule({
          ruleId: 'RULE-001',
          conditionExpression: { field: 'quantity', operator: '>', value: 0 },
        }),
        createTestRule({
          ruleId: 'RULE-002',
          conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        }),
      ]

      const result = await evaluate(rules, { quantity: 10, status: 'ACTIVE' }, {})

      expect(result.success).toBe(true)
      expect(result.matchedRules).toHaveLength(2)
      expect(result.failedRules).toHaveLength(0)
      expect(result.evaluationTime).toBeGreaterThanOrEqual(0)
    })

    test('should separate matched and failed rules', async () => {
      const rules = [
        createTestRule({
          ruleId: 'RULE-001',
          conditionExpression: { field: 'quantity', operator: '>', value: 0 },
        }),
        createTestRule({
          ruleId: 'RULE-002',
          conditionExpression: { field: 'status', operator: '=', value: 'DELETED' },
        }),
      ]

      const result = await evaluate(rules, { quantity: 10, status: 'ACTIVE' }, {})

      expect(result.success).toBe(true)
      expect(result.matchedRules).toHaveLength(1)
      expect(result.matchedRules[0].ruleId).toBe('RULE-001')
      expect(result.failedRules).toHaveLength(1)
      expect(result.failedRules[0].ruleId).toBe('RULE-002')
    })

    test('should collect errors from failed rules', async () => {
      const rules = [
        createTestRule({
          ruleId: 'RULE-001',
          enabled: false,
        }),
        createTestRule({
          ruleId: 'RULE-002',
          conditionExpression: { field: 'value', operator: 'INVALID' as any, value: 10 },
        }),
      ]

      const result = await evaluate(rules, { value: 10 }, {})

      expect(result.success).toBe(false)
      expect(result.errors).toBeDefined()
      expect(result.errors?.length).toBe(2)
      expect(result.errors?.[0]).toContain('RULE-001')
      expect(result.errors?.[1]).toContain('RULE-002')
    })

    test('should evaluate rules in priority order', async () => {
      const executionOrder: string[] = []

      const rules = [
        createTestRule({
          ruleId: 'LOW',
          priority: 50,
          conditionExpression: { field: 'always', operator: '=', value: true },
        }),
        createTestRule({
          ruleId: 'HIGH',
          priority: 200,
          conditionExpression: { field: 'always', operator: '=', value: true },
        }),
        createTestRule({
          ruleId: 'MEDIUM',
          priority: 100,
          conditionExpression: { field: 'always', operator: '=', value: true },
        }),
      ]

      const result = await evaluate(rules, { always: true }, {})

      // Check that rules were matched in priority order
      expect(result.matchedRules[0].ruleId).toBe('HIGH')
      expect(result.matchedRules[1].ruleId).toBe('MEDIUM')
      expect(result.matchedRules[2].ruleId).toBe('LOW')
    })
  })

  describe('sortRulesByPriority', () => {
    test('should sort rules by priority (highest first)', () => {
      const rules = [
        createTestRule({ ruleId: 'LOW', priority: 50 }),
        createTestRule({ ruleId: 'HIGH', priority: 200 }),
        createTestRule({ ruleId: 'MEDIUM', priority: 100 }),
      ]

      const sorted = sortRulesByPriority(rules)

      expect(sorted[0].ruleId).toBe('HIGH')
      expect(sorted[1].ruleId).toBe('MEDIUM')
      expect(sorted[2].ruleId).toBe('LOW')
    })

    test('should sort by ruleId when priority is the same', () => {
      const rules = [
        createTestRule({ ruleId: 'RULE-C', priority: 100 }),
        createTestRule({ ruleId: 'RULE-A', priority: 100 }),
        createTestRule({ ruleId: 'RULE-B', priority: 100 }),
      ]

      const sorted = sortRulesByPriority(rules)

      expect(sorted[0].ruleId).toBe('RULE-A')
      expect(sorted[1].ruleId).toBe('RULE-B')
      expect(sorted[2].ruleId).toBe('RULE-C')
    })

    test('should not mutate original array', () => {
      const rules = [
        createTestRule({ ruleId: 'LOW', priority: 50 }),
        createTestRule({ ruleId: 'HIGH', priority: 200 }),
      ]

      const originalOrder = rules.map((r) => r.ruleId)
      sortRulesByPriority(rules)

      expect(rules.map((r) => r.ruleId)).toEqual(originalOrder)
    })
  })

  describe('filterRulesByContext', () => {
    test('should filter by entity type', () => {
      const rules = [
        createTestRule({ ruleId: 'RULE-1', entityType: 'WorkOrder' }),
        createTestRule({ ruleId: 'RULE-2', entityType: 'Item' }),
        createTestRule({ ruleId: 'RULE-3', entityType: 'WorkOrder' }),
      ]

      const filtered = filterRulesByContext(rules, 'WorkOrder')

      expect(filtered).toHaveLength(2)
      expect(filtered[0].ruleId).toBe('RULE-1')
      expect(filtered[1].ruleId).toBe('RULE-3')
    })

    test('should filter by event type', () => {
      const rules = [
        createTestRule({ ruleId: 'RULE-1', eventType: 'beforeSave' }),
        createTestRule({ ruleId: 'RULE-2', eventType: 'afterSave' }),
        createTestRule({ ruleId: 'RULE-3', eventType: null }),
      ]

      const filtered = filterRulesByContext(rules, undefined, 'beforeSave')

      // RULE-1 matches, RULE-3 has no event type so it passes
      expect(filtered).toHaveLength(2)
      expect(filtered.map((r) => r.ruleId)).toContain('RULE-1')
      expect(filtered.map((r) => r.ruleId)).toContain('RULE-3')
    })

    test('should filter by both entity type and event type', () => {
      const rules = [
        createTestRule({ ruleId: 'RULE-1', entityType: 'WorkOrder', eventType: 'beforeSave' }),
        createTestRule({ ruleId: 'RULE-2', entityType: 'Item', eventType: 'beforeSave' }),
        createTestRule({ ruleId: 'RULE-3', entityType: 'WorkOrder', eventType: 'afterSave' }),
        createTestRule({ ruleId: 'RULE-4', entityType: 'WorkOrder', eventType: null }),
      ]

      const filtered = filterRulesByContext(rules, 'WorkOrder', 'beforeSave')

      expect(filtered).toHaveLength(2)
      expect(filtered.map((r) => r.ruleId)).toContain('RULE-1')
      expect(filtered.map((r) => r.ruleId)).toContain('RULE-4')
    })

    test('should return all rules when no filters provided', () => {
      const rules = [
        createTestRule({ ruleId: 'RULE-1' }),
        createTestRule({ ruleId: 'RULE-2' }),
      ]

      const filtered = filterRulesByContext(rules)

      expect(filtered).toHaveLength(2)
    })
  })

  describe('getApplicableRules', () => {
    test('should return enabled, effective, and sorted rules', () => {
      const yesterday = new Date(Date.now() - 86400000)
      const tomorrow = new Date(Date.now() + 86400000)

      const rules = [
        createTestRule({ ruleId: 'RULE-1', priority: 100, enabled: true }),
        createTestRule({ ruleId: 'RULE-2', priority: 200, enabled: false }), // Disabled
        createTestRule({ ruleId: 'RULE-3', priority: 150, effectiveFrom: tomorrow }), // Not yet effective
        createTestRule({ ruleId: 'RULE-4', priority: 50, effectiveTo: yesterday }), // Expired
        createTestRule({ ruleId: 'RULE-5', priority: 300, enabled: true }),
      ]

      const applicable = getApplicableRules(rules)

      expect(applicable).toHaveLength(2)
      expect(applicable[0].ruleId).toBe('RULE-5') // Highest priority
      expect(applicable[1].ruleId).toBe('RULE-1')
    })

    test('should filter by entity type and event type', () => {
      const rules = [
        createTestRule({ ruleId: 'RULE-1', entityType: 'WorkOrder', priority: 100 }),
        createTestRule({ ruleId: 'RULE-2', entityType: 'Item', priority: 200 }),
        createTestRule({ ruleId: 'RULE-3', entityType: 'WorkOrder', priority: 150 }),
      ]

      const applicable = getApplicableRules(rules, 'WorkOrder')

      expect(applicable).toHaveLength(2)
      expect(applicable[0].ruleId).toBe('RULE-3') // Higher priority
      expect(applicable[1].ruleId).toBe('RULE-1')
    })
  })
})
