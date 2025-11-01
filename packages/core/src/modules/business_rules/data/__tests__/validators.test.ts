import { describe, test, expect } from '@jest/globals'
import {
  createBusinessRuleSchema,
  updateBusinessRuleSchema,
  ruleTypeSchema,
  comparisonOperatorSchema,
  type CreateBusinessRuleInput,
} from '../validators'

describe('Business Rules Validators', () => {
  describe('ruleTypeSchema', () => {
    test('should accept valid rule types', () => {
      expect(ruleTypeSchema.parse('GUARD')).toBe('GUARD')
      expect(ruleTypeSchema.parse('VALIDATION')).toBe('VALIDATION')
      expect(ruleTypeSchema.parse('CALCULATION')).toBe('CALCULATION')
      expect(ruleTypeSchema.parse('ACTION')).toBe('ACTION')
      expect(ruleTypeSchema.parse('ASSIGNMENT')).toBe('ASSIGNMENT')
    })

    test('should reject invalid rule types', () => {
      expect(() => ruleTypeSchema.parse('INVALID')).toThrow()
    })
  })

  describe('comparisonOperatorSchema', () => {
    test('should accept valid comparison operators', () => {
      expect(comparisonOperatorSchema.parse('=')).toBe('=')
      expect(comparisonOperatorSchema.parse('>')).toBe('>')
      expect(comparisonOperatorSchema.parse('IN')).toBe('IN')
      expect(comparisonOperatorSchema.parse('CONTAINS')).toBe('CONTAINS')
    })

    test('should reject invalid operators', () => {
      expect(() => comparisonOperatorSchema.parse('INVALID')).toThrow()
    })
  })

  describe('createBusinessRuleSchema', () => {
    const validRule: CreateBusinessRuleInput = {
      ruleId: 'TEST-001',
      ruleName: 'Test Rule',
      description: 'A test rule',
      ruleType: 'GUARD',
      ruleCategory: 'testing',
      entityType: 'WorkOrder',
      eventType: 'beforeStatusChange',
      conditionExpression: {
        field: 'status',
        operator: '=',
        value: 'RELEASED',
      },
      successActions: [
        {
          type: 'ALLOW_TRANSITION',
        },
      ],
      failureActions: [
        {
          type: 'BLOCK_TRANSITION',
        },
      ],
      enabled: true,
      priority: 100,
      version: 1,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete rule', () => {
      const result = createBusinessRuleSchema.parse(validRule)
      expect(result.ruleId).toBe('TEST-001')
      expect(result.ruleName).toBe('Test Rule')
      expect(result.ruleType).toBe('GUARD')
      expect(result.enabled).toBe(true)
      expect(result.priority).toBe(100)
    })

    test('should apply default values', () => {
      const minimal = {
        ruleId: 'TEST-002',
        ruleName: 'Minimal Rule',
        ruleType: 'VALIDATION' as const,
        entityType: 'Item',
        conditionExpression: { field: 'quantity', operator: '>', value: 0 },
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createBusinessRuleSchema.parse(minimal)
      expect(result.enabled).toBe(true)
      expect(result.priority).toBe(100)
      expect(result.version).toBe(1)
    })

    test('should reject missing required fields', () => {
      const invalid = {
        ruleName: 'Missing Rule ID',
        ruleType: 'GUARD',
      }

      expect(() => createBusinessRuleSchema.parse(invalid)).toThrow()
    })

    test('should validate ruleId length', () => {
      const tooLong = {
        ...validRule,
        ruleId: 'A'.repeat(51), // Max is 50
      }

      expect(() => createBusinessRuleSchema.parse(tooLong)).toThrow()
    })

    test('should validate ruleName length', () => {
      const tooLong = {
        ...validRule,
        ruleName: 'A'.repeat(201), // Max is 200
      }

      expect(() => createBusinessRuleSchema.parse(tooLong)).toThrow()
    })

    test('should validate priority range', () => {
      const negativePriority = {
        ...validRule,
        priority: -1,
      }

      expect(() => createBusinessRuleSchema.parse(negativePriority)).toThrow()

      const tooHighPriority = {
        ...validRule,
        priority: 10000,
      }

      expect(() => createBusinessRuleSchema.parse(tooHighPriority)).toThrow()
    })

    test('should validate UUID format', () => {
      const invalidUuid = {
        ...validRule,
        tenantId: 'not-a-uuid',
      }

      expect(() => createBusinessRuleSchema.parse(invalidUuid)).toThrow()
    })

    test('should accept null/undefined for optional fields', () => {
      const withNulls = {
        ...validRule,
        description: null,
        ruleCategory: null,
        eventType: null,
        successActions: null,
        failureActions: null,
        effectiveFrom: null,
        effectiveTo: null,
        createdBy: null,
      }

      const result = createBusinessRuleSchema.parse(withNulls)
      expect(result.description).toBeNull()
      expect(result.ruleCategory).toBeNull()
    })
  })

  describe('updateBusinessRuleSchema', () => {
    test('should make all fields optional except id', () => {
      const minimalUpdate = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        ruleName: 'Updated Name',
      }

      const result = updateBusinessRuleSchema.parse(minimalUpdate)
      expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000')
      expect(result.ruleName).toBe('Updated Name')
    })

    test('should require id field', () => {
      const noId = {
        ruleName: 'Updated Name',
      }

      expect(() => updateBusinessRuleSchema.parse(noId)).toThrow()
    })
  })
})
