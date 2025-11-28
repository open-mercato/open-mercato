import {
  generateRuleId,
  getEntityTypeSuggestions,
  getEventTypeSuggestions,
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
})
