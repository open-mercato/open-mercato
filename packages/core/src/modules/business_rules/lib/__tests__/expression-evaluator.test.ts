import { describe, test, expect } from '@jest/globals'
import {
  evaluateExpression,
  type SimpleCondition,
  type GroupCondition,
  type EvaluationContext,
} from '../expression-evaluator'

describe('RuleExpressionEvaluator', () => {

  describe('Simple Conditions - Equality Operators', () => {
    test('should evaluate = operator (equal)', () => {
      const condition: SimpleCondition = {
        field: 'status',
        operator: '=',
        value: 'ACTIVE',
      }
      expect(evaluateExpression(condition, { status: 'ACTIVE' }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'INACTIVE' }, {})).toBe(false)
    })

    test('should evaluate == operator (equal)', () => {
      const condition: SimpleCondition = {
        field: 'count',
        operator: '==',
        value: 10,
      }
      expect(evaluateExpression(condition, { count: 10 }, {})).toBe(true)
      expect(evaluateExpression(condition, { count: '10' }, {})).toBe(true) // Type coercion
      expect(evaluateExpression(condition, { count: 5 }, {})).toBe(false)
    })

    test('should evaluate != operator (not equal)', () => {
      const condition: SimpleCondition = {
        field: 'status',
        operator: '!=',
        value: 'DELETED',
      }
      expect(evaluateExpression(condition, { status: 'ACTIVE' }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'DELETED' }, {})).toBe(false)
    })
  })

  describe('Simple Conditions - Comparison Operators', () => {
    test('should evaluate > operator (greater than)', () => {
      const condition: SimpleCondition = {
        field: 'quantity',
        operator: '>',
        value: 0,
      }
      expect(evaluateExpression(condition, { quantity: 10 }, {})).toBe(true)
      expect(evaluateExpression(condition, { quantity: 0 }, {})).toBe(false)
      expect(evaluateExpression(condition, { quantity: -5 }, {})).toBe(false)
    })

    test('should evaluate >= operator (greater than or equal)', () => {
      const condition: SimpleCondition = {
        field: 'price',
        operator: '>=',
        value: 100,
      }
      expect(evaluateExpression(condition, { price: 150 }, {})).toBe(true)
      expect(evaluateExpression(condition, { price: 100 }, {})).toBe(true)
      expect(evaluateExpression(condition, { price: 50 }, {})).toBe(false)
    })

    test('should evaluate < operator (less than)', () => {
      const condition: SimpleCondition = {
        field: 'age',
        operator: '<',
        value: 18,
      }
      expect(evaluateExpression(condition, { age: 15 }, {})).toBe(true)
      expect(evaluateExpression(condition, { age: 18 }, {})).toBe(false)
      expect(evaluateExpression(condition, { age: 25 }, {})).toBe(false)
    })

    test('should evaluate <= operator (less than or equal)', () => {
      const condition: SimpleCondition = {
        field: 'temperature',
        operator: '<=',
        value: 100,
      }
      expect(evaluateExpression(condition, { temperature: 50 }, {})).toBe(true)
      expect(evaluateExpression(condition, { temperature: 100 }, {})).toBe(true)
      expect(evaluateExpression(condition, { temperature: 150 }, {})).toBe(false)
    })
  })

  describe('Simple Conditions - Collection Operators', () => {
    test('should evaluate IN operator', () => {
      const condition: SimpleCondition = {
        field: 'status',
        operator: 'IN',
        value: ['ACTIVE', 'PENDING', 'PROCESSING'],
      }
      expect(evaluateExpression(condition, { status: 'ACTIVE' }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'PENDING' }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'DELETED' }, {})).toBe(false)
    })

    test('should evaluate NOT_IN operator', () => {
      const condition: SimpleCondition = {
        field: 'status',
        operator: 'NOT_IN',
        value: ['DELETED', 'ARCHIVED'],
      }
      expect(evaluateExpression(condition, { status: 'ACTIVE' }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'DELETED' }, {})).toBe(false)
    })

    test('should evaluate CONTAINS operator (array)', () => {
      const condition: SimpleCondition = {
        field: 'tags',
        operator: 'CONTAINS',
        value: 'urgent',
      }
      expect(evaluateExpression(condition, { tags: ['urgent', 'important'] }, {})).toBe(true)
      expect(evaluateExpression(condition, { tags: ['normal'] }, {})).toBe(false)
    })

    test('should evaluate CONTAINS operator (string)', () => {
      const condition: SimpleCondition = {
        field: 'description',
        operator: 'CONTAINS',
        value: 'bug',
      }
      expect(evaluateExpression(condition, { description: 'This is a bug fix' }, {})).toBe(true)
      expect(evaluateExpression(condition, { description: 'New feature' }, {})).toBe(false)
    })

    test('should evaluate NOT_CONTAINS operator', () => {
      const condition: SimpleCondition = {
        field: 'tags',
        operator: 'NOT_CONTAINS',
        value: 'deprecated',
      }
      expect(evaluateExpression(condition, { tags: ['new', 'stable'] }, {})).toBe(true)
      expect(evaluateExpression(condition, { tags: ['deprecated', 'old'] }, {})).toBe(false)
    })
  })

  describe('Simple Conditions - String Operators', () => {
    test('should evaluate STARTS_WITH operator', () => {
      const condition: SimpleCondition = {
        field: 'email',
        operator: 'STARTS_WITH',
        value: 'admin',
      }
      expect(evaluateExpression(condition, { email: 'admin@example.com' }, {})).toBe(true)
      expect(evaluateExpression(condition, { email: 'user@example.com' }, {})).toBe(false)
    })

    test('should evaluate ENDS_WITH operator', () => {
      const condition: SimpleCondition = {
        field: 'filename',
        operator: 'ENDS_WITH',
        value: '.pdf',
      }
      expect(evaluateExpression(condition, { filename: 'document.pdf' }, {})).toBe(true)
      expect(evaluateExpression(condition, { filename: 'image.jpg' }, {})).toBe(false)
    })

    test('should evaluate MATCHES operator (regex)', () => {
      const condition: SimpleCondition = {
        field: 'code',
        operator: 'MATCHES',
        value: '^[A-Z]{3}-\\d{3}$',
      }
      expect(evaluateExpression(condition, { code: 'ABC-123' }, {})).toBe(true)
      expect(evaluateExpression(condition, { code: 'abc-123' }, {})).toBe(false)
      expect(evaluateExpression(condition, { code: 'XYZ' }, {})).toBe(false)
    })
  })

  describe('Simple Conditions - Empty Operators', () => {
    test('should evaluate IS_EMPTY operator', () => {
      const condition: SimpleCondition = {
        field: 'notes',
        operator: 'IS_EMPTY',
        value: null,
      }
      expect(evaluateExpression(condition, { notes: '' }, {})).toBe(true)
      expect(evaluateExpression(condition, { notes: '   ' }, {})).toBe(true)
      expect(evaluateExpression(condition, { notes: null }, {})).toBe(true)
      expect(evaluateExpression(condition, { notes: undefined }, {})).toBe(true)
      expect(evaluateExpression(condition, { notes: [] }, {})).toBe(true)
      expect(evaluateExpression(condition, { notes: {} }, {})).toBe(true)
      expect(evaluateExpression(condition, { notes: 'Some text' }, {})).toBe(false)
    })

    test('should evaluate IS_NOT_EMPTY operator', () => {
      const condition: SimpleCondition = {
        field: 'name',
        operator: 'IS_NOT_EMPTY',
        value: null,
      }
      expect(evaluateExpression(condition, { name: 'John' }, {})).toBe(true)
      expect(evaluateExpression(condition, { name: [1, 2] }, {})).toBe(true)
      expect(evaluateExpression(condition, { name: '' }, {})).toBe(false)
      expect(evaluateExpression(condition, { name: null }, {})).toBe(false)
    })
  })

  describe('Field Path Resolution', () => {
    test('should resolve simple field paths', () => {
      const condition: SimpleCondition = {
        field: 'status',
        operator: '=',
        value: 'ACTIVE',
      }
      expect(evaluateExpression(condition, { status: 'ACTIVE' }, {})).toBe(true)
    })

    test('should resolve nested field paths (dot notation)', () => {
      const condition: SimpleCondition = {
        field: 'user.name',
        operator: '=',
        value: 'John',
      }
      const data = { user: { name: 'John', age: 30 } }
      expect(evaluateExpression(condition, data, {})).toBe(true)
    })

    test('should resolve deeply nested paths', () => {
      const condition: SimpleCondition = {
        field: 'order.customer.address.city',
        operator: '=',
        value: 'New York',
      }
      const data = {
        order: {
          customer: {
            address: {
              city: 'New York',
              zip: '10001',
            },
          },
        },
      }
      expect(evaluateExpression(condition, data, {})).toBe(true)
    })

    test('should resolve array element by index', () => {
      const condition: SimpleCondition = {
        field: 'items[0]',
        operator: '=',
        value: 'apple',
      }
      const data = { items: ['apple', 'banana', 'orange'] }
      expect(evaluateExpression(condition, data, {})).toBe(true)
    })

    test('should resolve nested array access', () => {
      const condition: SimpleCondition = {
        field: 'materials[0].quantity',
        operator: '>',
        value: 5,
      }
      const data = {
        materials: [
          { name: 'Steel', quantity: 10 },
          { name: 'Wood', quantity: 3 },
        ],
      }
      expect(evaluateExpression(condition, data, {})).toBe(true)
    })

    test('should return undefined for non-existent paths', () => {
      const condition: SimpleCondition = {
        field: 'nonexistent.field',
        operator: '=',
        value: 'some value',
      }
      const data = { status: 'ACTIVE' }
      expect(evaluateExpression(condition, data, {})).toBe(false)
    })

    test('should handle comparison of undefined to null', () => {
      const condition: SimpleCondition = {
        field: 'nonexistent',
        operator: '=',
        value: null,
      }
      // undefined == null is true in JavaScript (loose equality)
      expect(evaluateExpression(condition, {}, {})).toBe(true)
    })
  })

  describe('Field-to-Field Comparison', () => {
    test('should compare two fields', () => {
      const condition: SimpleCondition = {
        field: 'actualQuantity',
        operator: '>=',
        valueField: 'requiredQuantity',
        value: null,
      }
      expect(evaluateExpression(condition, { actualQuantity: 10, requiredQuantity: 8 }, {})).toBe(true)
      expect(evaluateExpression(condition, { actualQuantity: 5, requiredQuantity: 10 }, {})).toBe(false)
    })

    test('should compare nested fields', () => {
      const condition: SimpleCondition = {
        field: 'user.role',
        operator: '=',
        valueField: 'requiredRole',
        value: null,
      }
      const data = {
        user: { role: 'admin' },
        requiredRole: 'admin',
      }
      expect(evaluateExpression(condition, data, {})).toBe(true)
    })
  })

  describe('Special Value Resolution', () => {
    test('should resolve {{today}} to current date', () => {
      const condition: SimpleCondition = {
        field: 'dueDate',
        operator: '>=',
        value: '{{today}}',
      }
      const today = new Date().toISOString().split('T')[0]
      const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
      const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

      expect(evaluateExpression(condition, { dueDate: tomorrow }, {})).toBe(true)
      expect(evaluateExpression(condition, { dueDate: today }, {})).toBe(true)
      expect(evaluateExpression(condition, { dueDate: yesterday }, {})).toBe(false)
    })

    test('should resolve {{now}} to current timestamp', () => {
      const condition: SimpleCondition = {
        field: 'timestamp',
        operator: '=',
        value: '{{now}}',
      }
      const context = {
        now: new Date('2025-01-01T12:00:00Z'),
      }
      expect(evaluateExpression(condition, { timestamp: '2025-01-01T12:00:00.000Z' }, context)).toBe(true)
    })

    test('should resolve {{user.id}} from context', () => {
      const condition: SimpleCondition = {
        field: 'assignedTo',
        operator: '=',
        value: '{{user.id}}',
      }
      const context: EvaluationContext = {
        user: { id: 'user-123', email: 'user@example.com' },
      }
      expect(evaluateExpression(condition, { assignedTo: 'user-123' }, context)).toBe(true)
      expect(evaluateExpression(condition, { assignedTo: 'user-456' }, context)).toBe(false)
    })

    test('should resolve {{tenant.id}} from context', () => {
      const condition: SimpleCondition = {
        field: 'tenantId',
        operator: '=',
        value: '{{tenant.id}}',
      }
      const context: EvaluationContext = {
        tenant: { id: 'tenant-abc' },
      }
      expect(evaluateExpression(condition, { tenantId: 'tenant-abc' }, context)).toBe(true)
    })
  })

  describe('Group Conditions - AND Operator', () => {
    test('should evaluate AND with all conditions true', () => {
      const condition: GroupCondition = {
        operator: 'AND',
        rules: [
          { field: 'status', operator: '=', value: 'ACTIVE' },
          { field: 'quantity', operator: '>', value: 0 },
        ],
      }
      const data = { status: 'ACTIVE', quantity: 10 }
      expect(evaluateExpression(condition, data, {})).toBe(true)
    })

    test('should evaluate AND with one condition false', () => {
      const condition: GroupCondition = {
        operator: 'AND',
        rules: [
          { field: 'status', operator: '=', value: 'ACTIVE' },
          { field: 'quantity', operator: '>', value: 0 },
        ],
      }
      const data = { status: 'ACTIVE', quantity: 0 }
      expect(evaluateExpression(condition, data, {})).toBe(false)
    })

    test('should evaluate AND with empty rules', () => {
      const condition: GroupCondition = {
        operator: 'AND',
        rules: [],
      }
      expect(evaluateExpression(condition, {}, {})).toBe(true)
    })
  })

  describe('Group Conditions - OR Operator', () => {
    test('should evaluate OR with one condition true', () => {
      const condition: GroupCondition = {
        operator: 'OR',
        rules: [
          { field: 'status', operator: '=', value: 'URGENT' },
          { field: 'priority', operator: '=', value: 'HIGH' },
        ],
      }
      const data = { status: 'NORMAL', priority: 'HIGH' }
      expect(evaluateExpression(condition, data, {})).toBe(true)
    })

    test('should evaluate OR with all conditions false', () => {
      const condition: GroupCondition = {
        operator: 'OR',
        rules: [
          { field: 'status', operator: '=', value: 'URGENT' },
          { field: 'priority', operator: '=', value: 'HIGH' },
        ],
      }
      const data = { status: 'NORMAL', priority: 'LOW' }
      expect(evaluateExpression(condition, data, {})).toBe(false)
    })
  })

  describe('Group Conditions - NOT Operator', () => {
    test('should evaluate NOT with single rule', () => {
      const condition: GroupCondition = {
        operator: 'NOT',
        rules: [{ field: 'status', operator: '=', value: 'DELETED' }],
      }
      expect(evaluateExpression(condition, { status: 'ACTIVE' }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'DELETED' }, {})).toBe(false)
    })

    test('should evaluate NOT with multiple rules (combined with AND)', () => {
      const condition: GroupCondition = {
        operator: 'NOT',
        rules: [
          { field: 'status', operator: '=', value: 'DELETED' },
          { field: 'archived', operator: '=', value: true },
        ],
      }
      expect(evaluateExpression(condition, { status: 'ACTIVE', archived: false }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'DELETED', archived: true }, {})).toBe(false)
    })
  })

  describe('Nested Group Conditions', () => {
    test('should evaluate nested AND and OR conditions', () => {
      const condition: GroupCondition = {
        operator: 'AND',
        rules: [
          { field: 'status', operator: '=', value: 'ACTIVE' },
          {
            operator: 'OR',
            rules: [
              { field: 'priority', operator: '=', value: 'HIGH' },
              { field: 'urgent', operator: '=', value: true },
            ],
          },
        ],
      }

      expect(evaluateExpression(condition, { status: 'ACTIVE', priority: 'HIGH' }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'ACTIVE', urgent: true }, {})).toBe(true)
      expect(evaluateExpression(condition, { status: 'ACTIVE', priority: 'LOW', urgent: false }, {})).toBe(false)
      expect(evaluateExpression(condition, { status: 'INACTIVE', priority: 'HIGH' }, {})).toBe(false)
    })

    test('should evaluate deeply nested conditions', () => {
      const condition: GroupCondition = {
        operator: 'OR',
        rules: [
          {
            operator: 'AND',
            rules: [
              { field: 'type', operator: '=', value: 'urgent' },
              { field: 'severity', operator: '=', value: 'critical' },
            ],
          },
          {
            operator: 'AND',
            rules: [
              { field: 'type', operator: '=', value: 'scheduled' },
              { field: 'approved', operator: '=', value: true },
            ],
          },
        ],
      }

      expect(evaluateExpression(condition, { type: 'urgent', severity: 'critical' }, {})).toBe(true)
      expect(evaluateExpression(condition, { type: 'scheduled', approved: true }, {})).toBe(true)
      expect(evaluateExpression(condition, { type: 'urgent', severity: 'low' }, {})).toBe(false)
      expect(evaluateExpression(condition, { type: 'scheduled', approved: false }, {})).toBe(false)
    })
  })

  describe('Edge Cases', () => {
    test('should handle null values', () => {
      const condition: SimpleCondition = {
        field: 'value',
        operator: '=',
        value: null,
      }
      expect(evaluateExpression(condition, { value: null }, {})).toBe(true)
      expect(evaluateExpression(condition, { value: 'something' }, {})).toBe(false)
    })

    test('should handle undefined values', () => {
      const condition: SimpleCondition = {
        field: 'missing',
        operator: 'IS_EMPTY',
        value: null,
      }
      expect(evaluateExpression(condition, {}, {})).toBe(true)
    })

    test('should handle type coercion for numbers', () => {
      const condition: SimpleCondition = {
        field: 'count',
        operator: '=',
        value: 10,
      }
      expect(evaluateExpression(condition, { count: '10' }, {})).toBe(true)
    })

    test('should handle date string comparisons', () => {
      const condition: SimpleCondition = {
        field: 'date',
        operator: '>',
        value: '2025-01-01',
      }
      expect(evaluateExpression(condition, { date: '2025-01-15' }, {})).toBe(true)
      expect(evaluateExpression(condition, { date: '2024-12-15' }, {})).toBe(false)
    })

    test('should handle invalid regex patterns gracefully', () => {
      const condition: SimpleCondition = {
        field: 'text',
        operator: 'MATCHES',
        value: '[invalid',
      }
      expect(evaluateExpression(condition, { text: 'anything' }, {})).toBe(false)
    })
  })

  describe('Security - ReDoS Protection', () => {
    test('should reject overly long regex patterns', () => {
      const longPattern = 'a'.repeat(300)
      const condition: SimpleCondition = {
        field: 'text',
        operator: 'MATCHES',
        value: longPattern,
      }
      expect(evaluateExpression(condition, { text: 'test' }, {})).toBe(false)
    })

    test('should reject dangerous exponential backtracking patterns', () => {
      const dangerousPatterns = [
        '(a+)+',
        '(a*)*',
        '(a+)*',
        '(.*)*',
      ]

      dangerousPatterns.forEach(pattern => {
        const condition: SimpleCondition = {
          field: 'text',
          operator: 'MATCHES',
          value: pattern,
        }
        expect(evaluateExpression(condition, { text: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, {})).toBe(false)
      })
    })

    test('should allow safe regex patterns', () => {
      const condition: SimpleCondition = {
        field: 'email',
        operator: 'MATCHES',
        value: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$',
      }
      expect(evaluateExpression(condition, { email: 'user@example.com' }, {})).toBe(true)
      expect(evaluateExpression(condition, { email: 'invalid-email' }, {})).toBe(false)
    })
  })
})
