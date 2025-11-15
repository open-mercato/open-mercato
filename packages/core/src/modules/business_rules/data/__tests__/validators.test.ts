import { describe, test, expect } from '@jest/globals'
import {
  createBusinessRuleSchema,
  updateBusinessRuleSchema,
  ruleTypeSchema,
  comparisonOperatorSchema,
  executionResultSchema,
  createRuleExecutionLogSchema,
  ruleExecutionLogFilterSchema,
  createRuleSetSchema,
  updateRuleSetSchema,
  ruleSetFilterSchema,
  createRuleSetMemberSchema,
  updateRuleSetMemberSchema,
  ruleSetMemberFilterSchema,
  type CreateBusinessRuleInput,
  type CreateRuleExecutionLogInput,
  type CreateRuleSetInput,
  type CreateRuleSetMemberInput,
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

  describe('executionResultSchema', () => {
    test('should accept valid execution results', () => {
      expect(executionResultSchema.parse('SUCCESS')).toBe('SUCCESS')
      expect(executionResultSchema.parse('FAILURE')).toBe('FAILURE')
      expect(executionResultSchema.parse('ERROR')).toBe('ERROR')
    })

    test('should reject invalid execution results', () => {
      expect(() => executionResultSchema.parse('INVALID')).toThrow()
    })
  })

  describe('createRuleExecutionLogSchema', () => {
    const validLog: CreateRuleExecutionLogInput = {
      ruleId: '123e4567-e89b-12d3-a456-426614174000',
      entityId: '123e4567-e89b-12d3-a456-426614174002',
      entityType: 'WorkOrder',
      executionResult: 'SUCCESS',
      inputContext: { quantity: 10, status: 'RELEASED' },
      outputContext: { allowed: true },
      executionTimeMs: 42,
      tenantId: '123e4567-e89b-12d3-a456-426614174003',
      organizationId: '123e4567-e89b-12d3-a456-426614174004',
    }

    test('should validate a complete execution log', () => {
      const result = createRuleExecutionLogSchema.parse(validLog)
      expect(result.ruleId).toBe(validLog.ruleId)
      expect(result.entityId).toBe(validLog.entityId)
      expect(result.entityType).toBe('WorkOrder')
      expect(result.executionResult).toBe('SUCCESS')
      expect(result.executionTimeMs).toBe(42)
    })

    test('should validate minimal execution log', () => {
      const minimal = {
        ruleId: '123e4567-e89b-12d3-a456-426614174000',
        entityId: '123e4567-e89b-12d3-a456-426614174002',
        entityType: 'Item',
        executionResult: 'FAILURE' as const,
        executionTimeMs: 15,
        tenantId: '123e4567-e89b-12d3-a456-426614174003',
      }

      const result = createRuleExecutionLogSchema.parse(minimal)
      expect(result.ruleId).toBe(minimal.ruleId)
      expect(result.executionResult).toBe('FAILURE')
    })

    test('should reject missing required fields', () => {
      const invalid = {
        entityType: 'WorkOrder',
        executionResult: 'SUCCESS',
      }

      expect(() => createRuleExecutionLogSchema.parse(invalid)).toThrow()
    })

    test('should validate executionTimeMs is non-negative', () => {
      const negativeTime = {
        ...validLog,
        executionTimeMs: -1,
      }

      expect(() => createRuleExecutionLogSchema.parse(negativeTime)).toThrow()
    })

    test('should validate UUID format for IDs', () => {
      const invalidRuleId = {
        ...validLog,
        ruleId: 'not-a-uuid',
      }

      expect(() => createRuleExecutionLogSchema.parse(invalidRuleId)).toThrow()

      const invalidEntityId = {
        ...validLog,
        entityId: 'not-a-uuid',
      }

      expect(() => createRuleExecutionLogSchema.parse(invalidEntityId)).toThrow()
    })

    test('should validate entityType length', () => {
      const tooLong = {
        ...validLog,
        entityType: 'A'.repeat(51), // Max is 50
      }

      expect(() => createRuleExecutionLogSchema.parse(tooLong)).toThrow()
    })

    test('should accept null/undefined for optional fields', () => {
      const withNulls = {
        ...validLog,
        inputContext: null,
        outputContext: null,
        errorMessage: null,
        organizationId: null,
        executedBy: null,
      }

      const result = createRuleExecutionLogSchema.parse(withNulls)
      expect(result.inputContext).toBeNull()
      expect(result.outputContext).toBeNull()
      expect(result.errorMessage).toBeNull()
    })

    test('should accept error log with error message', () => {
      const errorLog = {
        ...validLog,
        executionResult: 'ERROR' as const,
        errorMessage: 'Division by zero error',
        outputContext: null,
      }

      const result = createRuleExecutionLogSchema.parse(errorLog)
      expect(result.executionResult).toBe('ERROR')
      expect(result.errorMessage).toBe('Division by zero error')
    })

    test('should validate executedBy length', () => {
      const tooLong = {
        ...validLog,
        executedBy: 'A'.repeat(51), // Max is 50
      }

      expect(() => createRuleExecutionLogSchema.parse(tooLong)).toThrow()
    })
  })

  describe('ruleExecutionLogFilterSchema', () => {
    test('should validate filter with all fields', () => {
      const filter = {
        ruleId: '123e4567-e89b-12d3-a456-426614174000',
        entityId: '123e4567-e89b-12d3-a456-426614174002',
        entityType: 'WorkOrder',
        executionResult: 'SUCCESS' as const,
        tenantId: '123e4567-e89b-12d3-a456-426614174003',
        organizationId: '123e4567-e89b-12d3-a456-426614174004',
        executedBy: 'admin',
        executedAtFrom: new Date('2025-01-01'),
        executedAtTo: new Date('2025-12-31'),
      }

      const result = ruleExecutionLogFilterSchema.parse(filter)
      expect(result.ruleId).toBe(filter.ruleId)
      expect(result.executionResult).toBe('SUCCESS')
    })

    test('should validate empty filter', () => {
      const result = ruleExecutionLogFilterSchema.parse({})
      expect(result).toEqual({})
    })

    test('should validate partial filter', () => {
      const filter = {
        entityType: 'Item',
        executionResult: 'FAILURE' as const,
      }

      const result = ruleExecutionLogFilterSchema.parse(filter)
      expect(result.entityType).toBe('Item')
      expect(result.executionResult).toBe('FAILURE')
    })

    test('should validate UUID format in filter', () => {
      const invalidUuid = {
        ruleId: 'not-a-uuid',
      }

      expect(() => ruleExecutionLogFilterSchema.parse(invalidUuid)).toThrow()
    })
  })

  describe('createRuleSetSchema', () => {
    const validSet: CreateRuleSetInput = {
      setId: 'SET-001',
      setName: 'Production Rules',
      description: 'Rules for production environment',
      enabled: true,
      tenantId: '123e4567-e89b-12d3-a456-426614174000',
      organizationId: '123e4567-e89b-12d3-a456-426614174001',
    }

    test('should validate a complete rule set', () => {
      const result = createRuleSetSchema.parse(validSet)
      expect(result.setId).toBe('SET-001')
      expect(result.setName).toBe('Production Rules')
      expect(result.enabled).toBe(true)
    })

    test('should apply default values', () => {
      const minimal = {
        setId: 'SET-002',
        setName: 'Test Rules',
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = createRuleSetSchema.parse(minimal)
      expect(result.enabled).toBe(true)
    })

    test('should reject missing required fields', () => {
      const invalid = {
        setName: 'Missing Set ID',
      }

      expect(() => createRuleSetSchema.parse(invalid)).toThrow()
    })

    test('should validate setId length', () => {
      const tooLong = {
        ...validSet,
        setId: 'A'.repeat(51), // Max is 50
      }

      expect(() => createRuleSetSchema.parse(tooLong)).toThrow()
    })

    test('should validate setName length', () => {
      const tooLong = {
        ...validSet,
        setName: 'A'.repeat(201), // Max is 200
      }

      expect(() => createRuleSetSchema.parse(tooLong)).toThrow()
    })

    test('should validate UUID format', () => {
      const invalidUuid = {
        ...validSet,
        tenantId: 'not-a-uuid',
      }

      expect(() => createRuleSetSchema.parse(invalidUuid)).toThrow()
    })

    test('should accept null/undefined for optional fields', () => {
      const withNulls = {
        ...validSet,
        description: null,
        createdBy: null,
      }

      const result = createRuleSetSchema.parse(withNulls)
      expect(result.description).toBeNull()
      expect(result.createdBy).toBeNull()
    })
  })

  describe('updateRuleSetSchema', () => {
    test('should make all fields optional except id', () => {
      const minimalUpdate = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        setName: 'Updated Name',
      }

      const result = updateRuleSetSchema.parse(minimalUpdate)
      expect(result.id).toBe('123e4567-e89b-12d3-a456-426614174000')
      expect(result.setName).toBe('Updated Name')
    })

    test('should require id field', () => {
      const noId = {
        setName: 'Updated Name',
      }

      expect(() => updateRuleSetSchema.parse(noId)).toThrow()
    })
  })

  describe('ruleSetFilterSchema', () => {
    test('should validate filter with all fields', () => {
      const filter = {
        setId: 'SET-001',
        setName: 'Production',
        enabled: true,
        tenantId: '123e4567-e89b-12d3-a456-426614174000',
        organizationId: '123e4567-e89b-12d3-a456-426614174001',
      }

      const result = ruleSetFilterSchema.parse(filter)
      expect(result.setId).toBe('SET-001')
      expect(result.enabled).toBe(true)
    })

    test('should validate empty filter', () => {
      const result = ruleSetFilterSchema.parse({})
      expect(result).toEqual({})
    })

    test('should validate partial filter', () => {
      const filter = {
        enabled: false,
      }

      const result = ruleSetFilterSchema.parse(filter)
      expect(result.enabled).toBe(false)
    })
  })

  describe('createRuleSetMemberSchema', () => {
    const validMember: CreateRuleSetMemberInput = {
      ruleSetId: '123e4567-e89b-12d3-a456-426614174000',
      ruleId: '123e4567-e89b-12d3-a456-426614174002',
      sequence: 10,
      enabled: true,
      tenantId: '123e4567-e89b-12d3-a456-426614174003',
      organizationId: '123e4567-e89b-12d3-a456-426614174004',
    }

    test('should validate a complete rule set member', () => {
      const result = createRuleSetMemberSchema.parse(validMember)
      expect(result.ruleSetId).toBe(validMember.ruleSetId)
      expect(result.ruleId).toBe(validMember.ruleId)
      expect(result.sequence).toBe(10)
      expect(result.enabled).toBe(true)
    })

    test('should apply default values', () => {
      const minimal = {
        ruleSetId: '123e4567-e89b-12d3-a456-426614174000',
        ruleId: '123e4567-e89b-12d3-a456-426614174002',
        tenantId: '123e4567-e89b-12d3-a456-426614174003',
        organizationId: '123e4567-e89b-12d3-a456-426614174004',
      }

      const result = createRuleSetMemberSchema.parse(minimal)
      expect(result.sequence).toBe(0)
      expect(result.enabled).toBe(true)
    })

    test('should reject missing required fields', () => {
      const invalid = {
        ruleSetId: '123e4567-e89b-12d3-a456-426614174000',
      }

      expect(() => createRuleSetMemberSchema.parse(invalid)).toThrow()
    })

    test('should validate sequence is non-negative', () => {
      const negativeSequence = {
        ...validMember,
        sequence: -1,
      }

      expect(() => createRuleSetMemberSchema.parse(negativeSequence)).toThrow()
    })

    test('should validate UUID format for IDs', () => {
      const invalidRuleSetId = {
        ...validMember,
        ruleSetId: 'not-a-uuid',
      }

      expect(() => createRuleSetMemberSchema.parse(invalidRuleSetId)).toThrow()

      const invalidRuleId = {
        ...validMember,
        ruleId: 'not-a-uuid',
      }

      expect(() => createRuleSetMemberSchema.parse(invalidRuleId)).toThrow()
    })
  })

  describe('updateRuleSetMemberSchema', () => {
    test('should validate update with all fields', () => {
      const update = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        sequence: 20,
        enabled: false,
      }

      const result = updateRuleSetMemberSchema.parse(update)
      expect(result.id).toBe(update.id)
      expect(result.sequence).toBe(20)
      expect(result.enabled).toBe(false)
    })

    test('should require id field', () => {
      const noId = {
        sequence: 5,
      }

      expect(() => updateRuleSetMemberSchema.parse(noId)).toThrow()
    })

    test('should validate sequence is non-negative', () => {
      const negativeSequence = {
        id: '123e4567-e89b-12d3-a456-426614174000',
        sequence: -1,
      }

      expect(() => updateRuleSetMemberSchema.parse(negativeSequence)).toThrow()
    })
  })

  describe('ruleSetMemberFilterSchema', () => {
    test('should validate filter with all fields', () => {
      const filter = {
        ruleSetId: '123e4567-e89b-12d3-a456-426614174000',
        ruleId: '123e4567-e89b-12d3-a456-426614174002',
        enabled: true,
        tenantId: '123e4567-e89b-12d3-a456-426614174003',
        organizationId: '123e4567-e89b-12d3-a456-426614174004',
      }

      const result = ruleSetMemberFilterSchema.parse(filter)
      expect(result.ruleSetId).toBe(filter.ruleSetId)
      expect(result.ruleId).toBe(filter.ruleId)
      expect(result.enabled).toBe(true)
    })

    test('should validate empty filter', () => {
      const result = ruleSetMemberFilterSchema.parse({})
      expect(result).toEqual({})
    })

    test('should validate partial filter', () => {
      const filter = {
        enabled: false,
      }

      const result = ruleSetMemberFilterSchema.parse(filter)
      expect(result.enabled).toBe(false)
    })

    test('should validate UUID format in filter', () => {
      const invalidUuid = {
        ruleSetId: 'not-a-uuid',
      }

      expect(() => ruleSetMemberFilterSchema.parse(invalidUuid)).toThrow()
    })
  })
})
