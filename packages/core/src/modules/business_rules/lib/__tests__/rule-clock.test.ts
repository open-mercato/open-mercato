import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import type { EntityManager } from '@mikro-orm/core'
import type { BusinessRule } from '../../data/entities'
import { evaluateExpression, evaluateRegexMatch, type ConditionExpression } from '../expression-evaluator'
import { findApplicableRules } from '../rule-engine'
import { evaluateSingleRule, getApplicableRules, isRuleEffective } from '../rule-evaluator'
import { resolveSpecialValue } from '../value-resolver'

const NOW = new Date('2026-10-10T12:00:00.000Z')
const HISTORICAL = new Date('2026-03-15T08:30:00.000Z')
const TENANT_ID = '00000000-0000-4000-8000-0000000000a1'
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000a2'

function rule(ruleId: string, overrides: Partial<BusinessRule> = {}): BusinessRule {
  return {
    id: `id-${ruleId}`,
    ruleId,
    ruleName: ruleId,
    ruleType: 'GUARD',
    entityType: 'sales.order',
    conditionExpression: { field: 'status', operator: '=', value: 'won' },
    enabled: true,
    priority: 100,
    version: 1,
    tenantId: TENANT_ID,
    organizationId: ORGANIZATION_ID,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as BusinessRule
}

const currentRule = rule('CURRENT', { effectiveFrom: new Date('2026-10-01T00:00:00.000Z') })
const expiredRule = rule('EXPIRED', { effectiveTo: new Date('2026-04-01T00:00:00.000Z') })
const futureRule = rule('FUTURE', { effectiveFrom: new Date('2026-11-01T00:00:00.000Z') })
const openRule = rule('OPEN')

function createEm(rules: BusinessRule[]): EntityManager {
  return { find: jest.fn(async () => rules) } as unknown as EntityManager
}

const discovery = { entityType: 'sales.order', tenantId: TENANT_ID, organizationId: ORGANIZATION_ID }

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('isRuleEffective', () => {
  const marchWindow = rule('WINDOW', {
    effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
    effectiveTo: new Date('2026-04-01T00:00:00.000Z'),
  })

  test('treats both bounds as inclusive', () => {
    expect(isRuleEffective(marchWindow, new Date('2026-03-01T00:00:00.000Z'))).toBe(true)
    expect(isRuleEffective(marchWindow, new Date('2026-04-01T00:00:00.000Z'))).toBe(true)
  })

  test('rejects instants just outside the window', () => {
    expect(isRuleEffective(marchWindow, new Date('2026-02-28T23:59:59.999Z'))).toBe(false)
    expect(isRuleEffective(marchWindow, new Date('2026-04-01T00:00:00.001Z'))).toBe(false)
  })

  test('treats missing bounds as open', () => {
    expect(isRuleEffective({ effectiveFrom: null, effectiveTo: null }, new Date('1970-01-01T00:00:00.000Z'))).toBe(true)
    expect(isRuleEffective({}, new Date('2999-01-01T00:00:00.000Z'))).toBe(true)
  })

  test('defaults to the current time', () => {
    expect(isRuleEffective(marchWindow)).toBe(false)
    expect(isRuleEffective(currentRule)).toBe(true)
    expect(isRuleEffective(expiredRule)).toBe(false)
    expect(isRuleEffective(futureRule)).toBe(false)
  })
})

describe('findApplicableRules clock', () => {
  test('filters effective windows with the current time when no instant is given', async () => {
    const found = await findApplicableRules(createEm([currentRule, expiredRule, futureRule, openRule]), discovery)
    expect(found.map((entry) => entry.ruleId)).toEqual(['CURRENT', 'OPEN'])
  })

  test('filters effective windows at the given historical instant', async () => {
    const found = await findApplicableRules(createEm([currentRule, expiredRule, futureRule, openRule]), discovery, {}, HISTORICAL)
    expect(found.map((entry) => entry.ruleId)).toEqual(['EXPIRED', 'OPEN'])
  })

  test('caches the same ids whatever instant is replayed', async () => {
    const stored = new Map<string, unknown>()
    const cache = {
      get: jest.fn(async (key: string) => stored.get(key) ?? null),
      set: jest.fn(async (key: string, value: unknown) => {
        stored.set(key, value)
      }),
      deleteByTags: jest.fn(async () => 0),
    }
    const em = createEm([currentRule, expiredRule, futureRule, openRule])
    const historical = await findApplicableRules(em, discovery, { cache }, HISTORICAL)
    const current = await findApplicableRules(em, discovery, { cache })
    expect(historical.map((entry) => entry.ruleId)).toEqual(['EXPIRED', 'OPEN'])
    expect(current.map((entry) => entry.ruleId)).toEqual(['CURRENT', 'OPEN'])
    expect([...stored.values()]).toEqual([{ ruleIds: ['id-CURRENT', 'id-EXPIRED', 'id-FUTURE', 'id-OPEN'] }])
  })
})

describe('getApplicableRules clock', () => {
  test('keeps filtering with the current time', () => {
    const applicable = getApplicableRules([currentRule, expiredRule, futureRule, openRule], 'sales.order')
    expect(applicable.map((entry) => entry.ruleId).sort()).toEqual(['CURRENT', 'OPEN'])
  })
})

describe('evaluateSingleRule clock', () => {
  test('leaves effective windows on the current time without evaluatedAt', async () => {
    const result = await evaluateSingleRule(expiredRule, { status: 'won' }, {})
    expect(result.evaluationCompleted).toBe(false)
    expect(result.error).toBe('Rule is not effective (outside date range)')
    const current = await evaluateSingleRule(currentRule, { status: 'won' }, {})
    expect(current).toMatchObject({ conditionsPassed: true, evaluationCompleted: true })
  })

  test('honours evaluatedAt for effective windows', async () => {
    const historical = await evaluateSingleRule(expiredRule, { status: 'won' }, { evaluatedAt: HISTORICAL })
    expect(historical).toMatchObject({ conditionsPassed: true, evaluationCompleted: true })
    const notYet = await evaluateSingleRule(currentRule, { status: 'won' }, { evaluatedAt: HISTORICAL })
    expect(notYet.evaluationCompleted).toBe(false)
    expect(notYet.error).toBe('Rule is not effective (outside date range)')
  })

  test('context.now does not move effective windows', async () => {
    const result = await evaluateSingleRule(expiredRule, { status: 'won' }, { now: HISTORICAL })
    expect(result.evaluationCompleted).toBe(false)
  })

  test('still evaluates when a caller passes no context', async () => {
    const result = await evaluateSingleRule(currentRule, { status: 'won' }, undefined as never)
    expect(result).toMatchObject({ conditionsPassed: true, evaluationCompleted: true })
  })
})

describe('special values clock', () => {
  test('resolve from the current time when nothing is set', () => {
    expect(resolveSpecialValue('{{now}}', {})).toBe(NOW.toISOString())
    expect(resolveSpecialValue('{{today}}', {})).toBe('2026-10-10')
  })

  test('default from evaluatedAt when now / today are not set', () => {
    expect(resolveSpecialValue('{{now}}', { evaluatedAt: HISTORICAL })).toBe(HISTORICAL.toISOString())
    expect(resolveSpecialValue('{{today}}', { evaluatedAt: HISTORICAL })).toBe('2026-03-15')
  })

  test('context.now and context.today still win over evaluatedAt', () => {
    const explicitNow = new Date('2025-01-02T03:04:05.000Z')
    const explicitToday = new Date('2025-06-07T00:00:00.000Z')
    expect(resolveSpecialValue('{{now}}', { now: explicitNow, evaluatedAt: HISTORICAL })).toBe(explicitNow.toISOString())
    expect(resolveSpecialValue('{{today}}', { today: explicitToday, evaluatedAt: HISTORICAL })).toBe('2025-06-07')
    expect(resolveSpecialValue('{{today}}', { now: explicitNow, evaluatedAt: HISTORICAL })).toBe('2026-03-15')
  })

  test('evaluatedAt is never a template value: {{evaluatedAt}} resolves as in a context without it', () => {
    expect(resolveSpecialValue('{{evaluatedAt}}', { evaluatedAt: HISTORICAL })).toBeUndefined()
    expect(resolveSpecialValue('{{ evaluatedAt }}', { evaluatedAt: HISTORICAL })).toBeUndefined()
    expect(resolveSpecialValue('{{evaluatedAt.getTime}}', { evaluatedAt: HISTORICAL })).toBeUndefined()
    const beforeClock: ConditionExpression = { field: 'amount', operator: '<', value: '{{evaluatedAt}}' }
    expect(evaluateExpression(beforeClock, { amount: 5 }, { evaluatedAt: HISTORICAL })).toBe(evaluateExpression(beforeClock, { amount: 5 }, {}))
    expect(resolveSpecialValue('{{user.id}}', { user: { id: 'u1' }, evaluatedAt: HISTORICAL })).toBe('u1')
  })

  test('drive condition evaluation', () => {
    const dueBeforeToday: ConditionExpression = { field: 'dueDate', operator: '<', value: '{{today}}' }
    const data = { dueDate: '2026-05-01' }
    expect(evaluateExpression(dueBeforeToday, data, {})).toBe(true)
    expect(evaluateExpression(dueBeforeToday, data, { evaluatedAt: HISTORICAL })).toBe(false)
  })
})

describe('MATCHES guard stays production-identical', () => {
  const guarded: ReadonlyArray<[string, string, string]> = [
    ['an overlong pattern', 'a', 'a'.repeat(201)],
    ['a dangerous nested quantifier', 'aaaa', '(a+)+'],
    ['an invalid pattern', 'abc', '('],
    ['an overlong input', 'a'.repeat(10_001), 'a'],
  ]

  test.each(guarded)('%s does not match and is reported as rejected', (_label, input, pattern) => {
    const expression: ConditionExpression = { field: 'text', operator: 'MATCHES', value: pattern }
    expect(evaluateExpression(expression, { text: input }, {})).toBe(false)
    expect(evaluateRegexMatch(input, pattern)).toEqual({ matched: false, rejected: true })
  })

  test('null operands neither match nor count as rejected', () => {
    expect(evaluateRegexMatch(null, 'a')).toEqual({ matched: false, rejected: false })
    expect(evaluateRegexMatch('a', undefined)).toEqual({ matched: false, rejected: false })
  })

  test('accepted patterns report the match result', () => {
    expect(evaluateRegexMatch('order-42', '\\d+$')).toEqual({ matched: true, rejected: false })
    expect(evaluateRegexMatch('order', '\\d+$')).toEqual({ matched: false, rejected: false })
    expect(evaluateExpression({ field: 'text', operator: 'MATCHES', value: '\\d+$' }, { text: 'order-42' }, {})).toBe(true)
  })

  test('a pattern whose string conversion throws is rejected', () => {
    const hostile = { toString: () => { throw new Error('boom') } }
    expect(evaluateRegexMatch('abc', hostile)).toEqual({ matched: false, rejected: true })
    expect(evaluateExpression({ field: 'text', operator: 'MATCHES', value: hostile }, { text: 'abc' }, {})).toBe(false)
  })
})
