import { describe, expect, test } from '@jest/globals'
import {
  CONDITION_COMPARISON_OPERATORS,
  CONDITION_LOGICAL_OPERATORS,
  conditionComparisonOperatorSchema,
  conditionExpressionSchema,
  conditionLogicalOperatorSchema,
} from '../conditions'

describe('condition contract', () => {
  test('derives operator schemas from the canonical tuples', () => {
    expect(conditionComparisonOperatorSchema.options).toEqual([
      ...CONDITION_COMPARISON_OPERATORS,
    ])
    expect(conditionLogicalOperatorSchema.options).toEqual([
      ...CONDITION_LOGICAL_OPERATORS,
    ])
  })

  test('parses recursive conditions with JSON values', () => {
    const condition = {
      operator: 'AND',
      rules: [
        { field: 'invoice.total', operator: '>=', value: 1000 },
        {
          operator: 'OR',
          rules: [
            { field: 'invoice.currency', operator: '=', value: 'EUR' },
            { field: 'invoice.tags', operator: 'CONTAINS', value: ['priority'] },
          ],
        },
      ],
    }

    expect(conditionExpressionSchema.parse(condition)).toEqual(condition)
  })

  test('rejects invalid operators and non-JSON values', () => {
    expect(() => conditionExpressionSchema.parse({
      field: 'invoice.status',
      operator: 'equals',
      value: 'approved',
    })).toThrow()

    expect(() => conditionExpressionSchema.parse({
      field: 'invoice.createdAt',
      operator: '=',
      value: new Date(),
    })).toThrow()

    expect(() => conditionExpressionSchema.parse({
      field: 'invoice.callback',
      operator: '=',
      value: () => true,
    })).toThrow()

    expect(() => conditionExpressionSchema.parse({
      field: 'invoice.sequence',
      operator: '=',
      value: BigInt(1),
    })).toThrow()
  })
})
