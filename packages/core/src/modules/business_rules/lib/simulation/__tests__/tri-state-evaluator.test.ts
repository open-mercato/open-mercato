import { describe, expect, test } from '@jest/globals'
import type { ComparisonOperator, LogicalOperator } from '../../../data/validators'
import { evaluateExpression, type ConditionExpression, type EvaluationContext } from '../../expression-evaluator'
import {
  RULE_LOG_REDACTION_SENTINELS,
  evaluateConditionsTri,
  evaluateExpressionTri,
  isRuleLogRedactionSentinel,
} from '../tri-state-evaluator'

const context: EvaluationContext = { user: { id: 'u1' } }

const equalsWon: ConditionExpression = { field: 'status', operator: '=', value: 'won' }
const knownTrue: ConditionExpression = { field: 'flag', operator: '=', value: true }
const knownFalse: ConditionExpression = { field: 'flag', operator: '=', value: false }
const unknownLeaf: ConditionExpression = { field: 'secret', operator: '=', value: 'x' }
const throwingLeaf: ConditionExpression = { field: 'flag', operator: 'BETWEEN' as unknown as ComparisonOperator, value: 1 }
const baseData = { status: 'won', flag: true, secret: 'x' }
const unknownSecret = { unknownPaths: ['secret'] }

function group(operator: LogicalOperator, rules: ConditionExpression[]): ConditionExpression {
  return { operator, rules }
}

describe('evaluateExpressionTri: adapter-declared unknown paths', () => {
  test('an exact match makes the comparison unknown', () => {
    expect(evaluateExpressionTri(equalsWon, baseData, context, { unknownPaths: ['status'] })).toBe('unknown')
    expect(evaluateConditionsTri(equalsWon, baseData, context, { unknownPaths: ['status'] })).toEqual({
      outcome: 'unknown',
      reason: 'unknown_path',
    })
  })

  test('a declared ancestor makes a nested path unknown', () => {
    const expression: ConditionExpression = { field: 'customer.name', operator: '=', value: 'Ada' }
    const data = { customer: { name: 'Ada' } }
    expect(evaluateExpressionTri(expression, data, context, { unknownPaths: ['customer'] })).toBe('unknown')
  })

  test('a declared descendant makes the containing value unknown', () => {
    const data = { customer: { name: 'Ada', address: { city: 'Warsaw' } } }
    const unknownCity = { unknownPaths: ['customer.address.city'] }
    expect(evaluateExpressionTri({ field: 'customer', operator: 'IS_EMPTY', value: null }, data, context, unknownCity)).toBe('unknown')
    expect(evaluateExpressionTri({ field: 'customer.address', operator: 'IS_NOT_EMPTY', value: null }, data, context, unknownCity)).toBe('unknown')
  })

  test('siblings and look-alike prefixes stay known', () => {
    const data = { customer: { name: 'Ada', address: { city: 'Warsaw' } }, customerName: 'Ada' }
    const unknownAddress = { unknownPaths: ['customer.address'] }
    expect(evaluateExpressionTri({ field: 'customer.name', operator: '=', value: 'Ada' }, data, context, unknownAddress)).toBe(true)
    expect(evaluateExpressionTri({ field: 'customerName', operator: '=', value: 'Ada' }, data, context, { unknownPaths: ['customer'] })).toBe(true)
  })

  test('array notation is normalised on both sides', () => {
    const data = { items: [{ qty: 1 }, { qty: 2 }] }
    const firstQty: ConditionExpression = { field: 'items.0.qty', operator: '=', value: 1 }
    const firstItem: ConditionExpression = { field: 'items[0]', operator: 'IS_EMPTY', value: null }
    const secondQty: ConditionExpression = { field: 'items[1].qty', operator: '=', value: 2 }
    expect(evaluateExpressionTri(firstQty, data, context, { unknownPaths: ['items[0]'] })).toBe('unknown')
    expect(evaluateExpressionTri(firstItem, data, context, { unknownPaths: ['items.0.qty'] })).toBe('unknown')
    expect(evaluateExpressionTri(secondQty, data, context, { unknownPaths: ['items[0]'] })).toBe(true)
  })

  test('an unknown valueField makes a field-to-field comparison unknown', () => {
    const expression: ConditionExpression = { field: 'amount', operator: '>', value: null, valueField: 'limit' }
    expect(evaluateExpressionTri(expression, { amount: 10, limit: 5 }, context, { unknownPaths: ['limit'] })).toBe('unknown')
  })

  test('a path through a prototype key resolves to undefined in production, so it stays known', () => {
    const expression: ConditionExpression = { field: '__proto__.polluted', operator: 'IS_EMPTY', value: null }
    expect(evaluateExpressionTri(expression, { status: 'won' }, context, { unknownPaths: ['__proto__'] })).toBe(true)
  })
})

describe('evaluateExpressionTri: rule-log redaction sentinels', () => {
  test('exposes the sentinels sanitizeForLogging writes', () => {
    expect(RULE_LOG_REDACTION_SENTINELS).toEqual(['[REDACTED]', '[Max depth exceeded]'])
    expect(isRuleLogRedactionSentinel('[REDACTED]')).toBe(true)
    expect(isRuleLogRedactionSentinel('[Max depth exceeded]')).toBe(true)
    expect(isRuleLogRedactionSentinel('REDACTED')).toBe(false)
    expect(isRuleLogRedactionSentinel(null)).toBe(false)
  })

  test('a sentinel as the value on the path is unknown while production compares the placeholder', () => {
    const expression: ConditionExpression = { field: 'password', operator: '=', value: 'hunter2' }
    const data = { password: '[REDACTED]' }
    expect(evaluateExpression(expression, data, context)).toBe(false)
    expect(evaluateExpressionTri(expression, data, context)).toBe('unknown')
    expect(evaluateConditionsTri(expression, data, context)).toEqual({ outcome: 'unknown', reason: 'redacted' })
  })

  test('a sentinel on an ancestor makes every descendant unknown', () => {
    const data = { customer: '[Max depth exceeded]' }
    expect(evaluateExpressionTri({ field: 'customer.name', operator: 'IS_EMPTY', value: null }, data, context)).toBe('unknown')
    expect(evaluateExpressionTri({ field: 'customer.length', operator: '>', value: 3 }, data, context)).toBe('unknown')
  })

  test('a sentinel deep inside the resolved value makes it unknown, siblings stay known', () => {
    const data = { customer: { name: 'Ada', contact: { token: '[REDACTED]' } }, tags: ['vip', '[REDACTED]'] }
    expect(evaluateExpressionTri({ field: 'customer', operator: '=', value: 'Ada' }, data, context)).toBe('unknown')
    expect(evaluateExpressionTri({ field: 'tags', operator: 'CONTAINS', value: 'vip' }, data, context)).toBe('unknown')
    expect(evaluateExpressionTri({ field: 'customer.name', operator: '=', value: 'Ada' }, data, context)).toBe(true)
    expect(evaluateExpressionTri({ field: 'tags[0]', operator: '=', value: 'vip' }, data, context)).toBe(true)
  })

  test('emptiness of a container with redacted values inside is known: sanitizing keeps its keys and length', () => {
    const data = { customer: { name: 'Ada', contact: { token: '[REDACTED]' } }, tags: ['[REDACTED]'], nested: { deep: '[Max depth exceeded]' } }
    const cases: Array<[ConditionExpression, boolean]> = [
      [{ field: 'customer', operator: 'IS_EMPTY', value: null }, false],
      [{ field: 'customer.contact', operator: 'IS_NOT_EMPTY', value: null }, true],
      [{ field: 'tags', operator: 'IS_EMPTY', value: null }, false],
      [{ field: 'nested', operator: 'IS_NOT_EMPTY', value: null }, true],
    ]
    for (const [expression, expected] of cases) {
      expect(evaluateExpression(expression, data, context)).toBe(expected)
      expect(evaluateExpressionTri(expression, data, context)).toBe(expected)
    }
    expect(evaluateExpressionTri({ field: 'customer.contact.token', operator: 'IS_EMPTY', value: null }, data, context)).toBe('unknown')
    expect(evaluateExpressionTri({ field: 'nested.deep', operator: 'IS_NOT_EMPTY', value: null }, data, context)).toBe('unknown')
  })

  test('a redacted payload root is unknown for any path', () => {
    expect(evaluateExpressionTri(equalsWon, '[REDACTED]', context)).toBe('unknown')
  })
})

describe('evaluateExpressionTri: RE2 guard', () => {
  const rejected: ReadonlyArray<[string, string, string]> = [
    ['a pattern longer than 200 characters', 'a', 'a'.repeat(201)],
    ['a dangerous nested quantifier', 'aaaa', '(a+)+'],
    ['an invalid pattern', 'abc', '('],
    ['a pattern RE2 cannot compile', 'abc', '(?=a)'],
    ['an input longer than 10 000 characters', 'a'.repeat(10_001), 'a'],
  ]

  test.each(rejected)('%s is unknown while production returns false', (_label, input, pattern) => {
    const expression: ConditionExpression = { field: 'text', operator: 'MATCHES', value: pattern }
    const data = { text: input }
    expect(evaluateExpression(expression, data, context)).toBe(false)
    expect(evaluateExpressionTri(expression, data, context)).toBe('unknown')
    expect(evaluateConditionsTri(expression, data, context)).toEqual({ outcome: 'unknown', reason: 'regex_rejected' })
  })

  test('null operands are a known non-match, accepted patterns match like production', () => {
    expect(evaluateExpressionTri({ field: 'missing', operator: 'MATCHES', value: '(a+)+' }, {}, context)).toBe(false)
    expect(evaluateExpressionTri({ field: 'text', operator: 'MATCHES', value: '^ab' }, { text: 'abc' }, context)).toBe(true)
    expect(evaluateExpressionTri({ field: 'text', operator: 'MATCHES', value: '^b' }, { text: 'abc' }, context)).toBe(false)
  })
})

describe('evaluateExpressionTri: absent fields are known outcomes', () => {
  const data = { id: 'deal-1' }

  test.each<[ConditionExpression, boolean]>([
    [equalsWon, false],
    [{ field: 'status', operator: 'IS_EMPTY', value: null }, true],
    [{ field: 'status', operator: '!=', value: 'won' }, true],
    [{ field: 'status', operator: 'IN', value: ['won'] }, false],
    [{ field: 'customer.address.city', operator: 'IS_NOT_EMPTY', value: null }, false],
  ])('%j evaluates to %s like production', (expression, expected) => {
    expect(evaluateExpression(expression, data, context)).toBe(expected)
    expect(evaluateExpressionTri(expression, data, context)).toBe(expected)
  })
})

describe('evaluateExpressionTri: results that do not depend on the unknown operand', () => {
  const data = { left: null, count: 3, label: 'abc', list: 'not-a-list', secret: 'x' }

  test.each<[string, ConditionExpression, boolean]>([
    ['IS_EMPTY ignores an unknown valueField', { field: 'label', operator: 'IS_EMPTY', value: null, valueField: 'secret' }, false],
    ['STARTS_WITH on a known null is false', { field: 'left', operator: 'STARTS_WITH', value: null, valueField: 'secret' }, false],
    ['MATCHES with a known null pattern is false', { field: 'secret', operator: 'MATCHES', value: null }, false],
    ['CONTAINS on a known number is false', { field: 'count', operator: 'CONTAINS', value: null, valueField: 'secret' }, false],
    ['NOT_CONTAINS on a known null is true', { field: 'left', operator: 'NOT_CONTAINS', value: null, valueField: 'secret' }, true],
    ['IN a known non-array is false', { field: 'secret', operator: 'IN', value: null, valueField: 'list' }, false],
    ['NOT_IN a known empty list is true', { field: 'secret', operator: 'NOT_IN', value: [] }, true],
  ])('%s', (_label, expression, expected) => {
    expect(evaluateExpressionTri(expression, data, context, unknownSecret)).toBe(expected)
    expect(evaluateExpression(expression, data, context)).toBe(expected)
  })

  test('a comparison that depends on the unknown operand stays unknown', () => {
    expect(evaluateExpressionTri({ field: 'label', operator: 'CONTAINS', value: null, valueField: 'secret' }, data, context, unknownSecret)).toBe('unknown')
    expect(evaluateExpressionTri({ field: 'left', operator: '=', value: null, valueField: 'secret' }, data, context, unknownSecret)).toBe('unknown')
  })
})

describe('evaluateExpressionTri: Kleene logic', () => {
  test.each<[string, ConditionExpression, boolean | 'unknown']>([
    ['AND with a false child is false', group('AND', [unknownLeaf, knownFalse]), false],
    ['AND of unknown and true is unknown', group('AND', [unknownLeaf, knownTrue]), 'unknown'],
    ['AND of true children is true', group('AND', [knownTrue, equalsWon]), true],
    ['OR with a true child is true', group('OR', [unknownLeaf, knownTrue]), true],
    ['OR of unknown and false is unknown', group('OR', [unknownLeaf, knownFalse]), 'unknown'],
    ['NOT keeps unknown', group('NOT', [unknownLeaf]), 'unknown'],
    ['NOT negates a known child', group('NOT', [knownFalse]), true],
    ['NOT of several children negates their AND', group('NOT', [unknownLeaf, knownFalse]), true],
    ['an empty group is true', group('AND', []), true],
    ['an empty group with an unsupported operator is true', group('XOR' as unknown as LogicalOperator, []), true],
  ])('%s', (_label, expression, expected) => {
    expect(evaluateExpressionTri(expression, baseData, context, unknownSecret)).toBe(expected)
  })
})

describe('evaluateExpressionTri: errors', () => {
  test('an error after an unknown child of AND / OR is unknown', () => {
    expect(evaluateExpressionTri(group('AND', [unknownLeaf, throwingLeaf]), baseData, context, unknownSecret)).toBe('unknown')
    expect(evaluateExpressionTri(group('OR', [unknownLeaf, throwingLeaf]), baseData, context, unknownSecret)).toBe('unknown')
  })

  test('an error before any unknown child propagates', () => {
    expect(() => evaluateExpressionTri(group('AND', [throwingLeaf, unknownLeaf]), baseData, context, unknownSecret)).toThrow('Unknown operator: BETWEEN')
    expect(() => evaluateExpressionTri(group('OR', [knownFalse, throwingLeaf, unknownLeaf]), baseData, context, unknownSecret)).toThrow('Unknown operator: BETWEEN')
    expect(() => evaluateExpression(group('AND', [throwingLeaf, unknownLeaf]), baseData, context)).toThrow('Unknown operator: BETWEEN')
  })

  test('a possible error hidden in an unknown child keeps a later false child from deciding', () => {
    const expression = group('AND', [group('OR', [unknownLeaf, throwingLeaf]), knownFalse])
    expect(evaluateExpressionTri(expression, baseData, context, unknownSecret)).toBe('unknown')
    expect(evaluateExpression(expression, { ...baseData, secret: 'x' }, context)).toBe(false)
    expect(() => evaluateExpression(expression, { ...baseData, secret: 'y' }, context)).toThrow()
  })

  test('an error certain on every branch propagates even behind an unknown', () => {
    const expression = group('AND', [group('OR', [unknownLeaf, throwingLeaf]), throwingLeaf])
    expect(() => evaluateExpressionTri(expression, baseData, context, unknownSecret)).toThrow('Unknown operator: BETWEEN')
  })

  test('an unsupported comparison operator throws even when an operand is unknown', () => {
    const expression: ConditionExpression = { field: 'secret', operator: 'BETWEEN' as unknown as ComparisonOperator, value: 1 }
    expect(() => evaluateExpressionTri(expression, baseData, context, unknownSecret)).toThrow('Unknown operator: BETWEEN')
  })

  test('an unsupported logical operator throws before its children are evaluated', () => {
    const expression = group('XOR' as unknown as LogicalOperator, [unknownLeaf])
    expect(() => evaluateExpressionTri(expression, baseData, context, unknownSecret)).toThrow('Unknown logical operator: XOR')
  })

  test('a special value that cannot resolve throws even when the field is unknown', () => {
    const expression: ConditionExpression = { field: 'secret', operator: '=', value: '{{today}}' }
    const brokenClock = { today: 'not-a-date' as unknown as Date }
    expect(() => evaluateExpression(expression, baseData, brokenClock)).toThrow()
    expect(() => evaluateExpressionTri(expression, baseData, brokenClock, unknownSecret)).toThrow()
  })

  test('a malformed child throws like production', () => {
    const expression = group('AND', [knownTrue, null as unknown as ConditionExpression])
    expect(() => evaluateExpression(expression, baseData, context)).toThrow(TypeError)
    expect(() => evaluateExpressionTri(expression, baseData, context)).toThrow(TypeError)
  })
})

describe('evaluateConditionsTri', () => {
  test('missing conditions pass like evaluateConditions', () => {
    expect(evaluateConditionsTri(null, baseData, context)).toEqual({ outcome: 'true' })
    expect(evaluateConditionsTri(undefined, baseData, context)).toEqual({ outcome: 'true' })
  })

  test('maps known results and thrown errors', () => {
    expect(evaluateConditionsTri(equalsWon, baseData, context)).toEqual({ outcome: 'true' })
    expect(evaluateConditionsTri(knownFalse, baseData, context)).toEqual({ outcome: 'false' })
    expect(evaluateConditionsTri(throwingLeaf, baseData, context)).toEqual({ outcome: 'error' })
  })

  test('reports the reason of the unknown that made the outcome ambiguous', () => {
    const redacted = { ...baseData, password: '[REDACTED]' }
    const redactedLeaf: ConditionExpression = { field: 'password', operator: '=', value: 'x' }
    const expression = group('OR', [group('AND', [redactedLeaf, knownFalse]), unknownLeaf])
    expect(evaluateConditionsTri(expression, redacted, context, unknownSecret)).toEqual({
      outcome: 'unknown',
      reason: 'unknown_path',
    })
  })
})
