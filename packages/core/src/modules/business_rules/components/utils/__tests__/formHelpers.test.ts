import {
  generateRuleId,
  getEntityTypeSuggestions,
  getEventTypeSuggestions,
  parseRuleToFormValues,
  buildRulePayload,
} from '../formHelpers'

describe('formHelpers', () => {
  describe('generateRuleId', () => {
    it('should convert rule name to uppercase ID with underscores', () => {
      expect(generateRuleId('Customer Validation Rule')).toBe('CUSTOMER_VALIDATION_RULE')
    })

    it('should remove special characters', () => {
      expect(generateRuleId('Order! #123 @ Rule')).toBe('ORDER_123_RULE')
    })

    it('should trim leading and trailing underscores', () => {
      expect(generateRuleId('  Test Rule  ')).toBe('TEST_RULE')
    })

    it('should limit length to 50 characters', () => {
      const longName = 'A'.repeat(100)
      const result = generateRuleId(longName)
      expect(result.length).toBeLessThanOrEqual(50)
    })

    it('should handle empty string', () => {
      expect(generateRuleId('')).toBe('')
    })
  })

  describe('getEntityTypeSuggestions', () => {
    it('should return array of entity type suggestions', () => {
      const suggestions = getEntityTypeSuggestions()
      expect(Array.isArray(suggestions)).toBe(true)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('should include common entity types', () => {
      const suggestions = getEntityTypeSuggestions()
      expect(suggestions).toContain('WorkOrder')
      expect(suggestions).toContain('Order')
      expect(suggestions).toContain('Invoice')
      expect(suggestions).toContain('Customer')
    })
  })

  describe('getEventTypeSuggestions', () => {
    it('should return array of event type suggestions', () => {
      const suggestions = getEventTypeSuggestions()
      expect(Array.isArray(suggestions)).toBe(true)
      expect(suggestions.length).toBeGreaterThan(0)
    })

    it('should include common lifecycle events', () => {
      const suggestions = getEventTypeSuggestions()
      expect(suggestions).toContain('beforeCreate')
      expect(suggestions).toContain('afterCreate')
      expect(suggestions).toContain('beforeUpdate')
      expect(suggestions).toContain('afterUpdate')
      expect(suggestions).toContain('onStatusChange')
    })

    it('should accept optional entityType parameter', () => {
      const suggestions = getEventTypeSuggestions('Order')
      expect(Array.isArray(suggestions)).toBe(true)
    })
  })

  describe('parseRuleToFormValues', () => {
    it('normalizes ISO date strings to YYYY-MM-DD', () => {
      const rule = {
        ruleId: 'TEST_RULE',
        ruleName: 'Test Rule',
        ruleType: 'VALIDATION',
        entityType: 'Order',
        conditionExpression: { operator: 'AND', rules: [] },
        enabled: true,
        priority: 100,
        version: 1,
        effectiveFrom: '2026-04-11T18:44:27Z',
        effectiveTo: '2026-12-31T23:59:59Z',
      }

      const values = parseRuleToFormValues(rule)

      expect(values.effectiveFrom).toBe('2026-04-11')
      expect(values.effectiveTo).toBe('2026-12-31')
    })

    it('returns null for missing date fields', () => {
      const rule = {
        ruleId: 'TEST_RULE',
        ruleName: 'Test',
        ruleType: 'GUARD',
        entityType: 'Order',
        conditionExpression: null,
        enabled: true,
        priority: 0,
        version: 1,
        effectiveFrom: null,
        effectiveTo: undefined,
      }

      const values = parseRuleToFormValues(rule)

      expect(values.effectiveFrom).toBeNull()
      expect(values.effectiveTo).toBeNull()
    })

    it('passes through YYYY-MM-DD strings unchanged', () => {
      const rule = {
        ruleId: 'RULE',
        ruleName: 'Rule',
        ruleType: 'ACTION',
        entityType: 'Task',
        conditionExpression: null,
        enabled: false,
        priority: 50,
        version: 2,
        effectiveFrom: '2026-01-01',
        effectiveTo: '2026-06-30',
      }

      const values = parseRuleToFormValues(rule)

      expect(values.effectiveFrom).toBe('2026-01-01')
      expect(values.effectiveTo).toBe('2026-06-30')
    })

    it('wraps single condition in AND group', () => {
      const singleCondition = { field: 'status', operator: '==', value: 'active' }
      const rule = {
        ruleId: 'RULE',
        ruleName: 'Rule',
        ruleType: 'GUARD',
        entityType: 'Order',
        conditionExpression: singleCondition,
        enabled: true,
        priority: 100,
        version: 1,
      }

      const values = parseRuleToFormValues(rule)

      expect(values.conditionExpression).toEqual({
        operator: 'AND',
        rules: [singleCondition],
      })
    })
  })

  describe('buildRulePayload', () => {
    it('passes date strings through to the payload', () => {
      const payload = buildRulePayload(
        {
          ruleId: 'RULE',
          ruleName: 'Rule',
          ruleType: 'VALIDATION',
          entityType: 'Order',
          conditionExpression: null,
          enabled: true,
          priority: 100,
          version: 1,
          effectiveFrom: '2026-04-11',
          effectiveTo: '2026-12-31',
        },
        'tenant-1',
        'org-1',
      )

      expect(payload.effectiveFrom).toBe('2026-04-11')
      expect(payload.effectiveTo).toBe('2026-12-31')
    })

    it('normalizes empty date strings to null', () => {
      const payload = buildRulePayload(
        {
          ruleId: 'RULE',
          ruleName: 'Rule',
          ruleType: 'GUARD',
          entityType: 'Task',
          conditionExpression: null,
          enabled: true,
          priority: 0,
          version: 1,
          effectiveFrom: '',
          effectiveTo: null,
        },
        'tenant-1',
        'org-1',
      )

      expect(payload.effectiveFrom).toBeNull()
      expect(payload.effectiveTo).toBeNull()
    })
  })
})
