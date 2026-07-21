import { describe, expect, test } from '@jest/globals'
import {
  CONDITION_COMPARISON_OPERATORS,
  CONDITION_LOGICAL_OPERATORS,
} from '@open-mercato/shared/modules/conditions'
import type { SimpleCondition as EvaluatorSimpleCondition } from '../../../lib/expression-evaluator'
import {
  getComparisonOperators,
  getLogicalOperators,
  type SimpleCondition as ValidationSimpleCondition,
} from '../conditionValidation'

describe('condition validation operator options', () => {
  const translate = (key: string) => key

  test('uses every canonical comparison operator in contract order', () => {
    expect(getComparisonOperators(translate).map(({ value }) => value)).toEqual([
      ...CONDITION_COMPARISON_OPERATORS,
    ])
  })

  test('uses every canonical logical operator in contract order', () => {
    expect(getLogicalOperators(translate).map(({ value }) => value)).toEqual([
      ...CONDITION_LOGICAL_OPERATORS,
    ])
  })

  test('keeps existing business-rules condition value types broad', () => {
    const evaluatorCondition: EvaluatorSimpleCondition = {
      field: 'invoice.createdAt',
      operator: '=',
      value: new Date(),
    }
    const validationCondition: ValidationSimpleCondition = {
      field: 'invoice.callback',
      operator: '=',
      value: () => true,
    }
    const bigintCondition: ValidationSimpleCondition = {
      field: 'invoice.sequence',
      operator: '=',
      value: BigInt(1),
    }

    expect(evaluatorCondition.value).toBeInstanceOf(Date)
    expect(typeof validationCondition.value).toBe('function')
    expect(typeof bigintCondition.value).toBe('bigint')
  })
})
