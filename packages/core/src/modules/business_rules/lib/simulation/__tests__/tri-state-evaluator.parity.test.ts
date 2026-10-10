import { afterAll, beforeAll, describe, expect, jest, test } from '@jest/globals'
import type { ComparisonOperator, LogicalOperator } from '../../../data/validators'
import { evaluateExpression, type ConditionExpression, type EvaluationContext } from '../../expression-evaluator'
import { evaluateConditions } from '../../rule-evaluator'
import {
  RULE_LOG_REDACTION_SENTINELS,
  evaluateConditionsTri,
  evaluateExpressionTri,
  type TriBoolean,
} from '../tri-state-evaluator'

type Random = {
  next: () => number
  int: (min: number, max: number) => number
  chance: (probability: number) => boolean
  pick: <T>(items: readonly T[]) => T
}

function createRandom(seed: number): Random {
  let state = seed >>> 0
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    chance: (probability) => next() < probability,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  }
}

const OPERATORS: readonly ComparisonOperator[] = [
  '=', '==', '!=', '>', '>=', '<', '<=', 'IN', 'NOT_IN', 'CONTAINS', 'NOT_CONTAINS',
  'STARTS_WITH', 'ENDS_WITH', 'MATCHES', 'IS_EMPTY', 'IS_NOT_EMPTY',
]
const LOGICAL_OPERATORS: readonly LogicalOperator[] = ['AND', 'OR', 'NOT']
const PRIMITIVES: readonly unknown[] = [
  null, undefined, 0, 1, -1, 2.5, 10, 100, '10', '2.5', ' 7 ', '', ' ', 'won', 'lost', 'ACTIVE', 'abc', 'a.b',
  'b', 'xyz', 'u1', 'u2', '2026-01-01', '2026-10-10', '2026-10-10T08:00:00.000Z', '2025-12-31T23:59:59', true, false,
]
const NESTED_KEYS: readonly string[] = ['name', 'tier', 'qty', 'sku', 'city', 'address', 'status', 'length', '0']
const TOP_KEYS: readonly string[] = [
  'status', 'amount', 'count', 'name', 'flag', 'code', 'createdAt', 'dueDate', 'customer', 'items', 'tags',
]
const FIELD_PATHS: readonly string[] = [
  'status', 'amount', 'count', 'name', 'name.length', 'flag', 'code', 'createdAt', 'dueDate', 'missing',
  'customer', 'customer.name', 'customer.tier', 'customer.address', 'customer.address.city',
  'items', 'items.length', 'items[0]', 'items[0].qty', 'items.0.qty', 'items[1].sku', 'items[2]',
  'tags', 'tags[0]', 'tags.1', 'tags.length',
  '__proto__', 'constructor', 'customer.constructor.name', 'items[0].__proto__',
]
const UNKNOWN_PATH_POOL: readonly string[] = [
  'status', 'amount', 'name', 'customer', 'customer.name', 'customer.address', 'customer.address.city',
  'items', 'items[0]', 'items.1', 'items[0].qty', 'tags', 'tags[0]', 'tags.length', 'dueDate', 'missing',
]
const SPECIAL_VALUES: readonly string[] = ['{{now}}', '{{today}}', '{{user.id}}', '{{tenant.id}}', '{{user.missing}}']
const SAFE_PATTERNS: readonly string[] = ['^a', 'b$', '^[a-z]+$', '\\d+', 'won|lost', '^2026-', 'A', '.*', 'x?y', '^$', '\\.']
const REJECTED_PATTERNS: readonly string[] = ['(a+)+', '(', '[z-a]', 'a'.repeat(201)]
const FROZEN_NOW = new Date('2026-10-10T09:30:00.000Z')

function randomValue(random: Random, depth: number): unknown {
  const roll = random.next()
  if (depth >= 3 || roll < 0.6) return random.pick(PRIMITIVES)
  if (roll < 0.8) {
    return Array.from({ length: random.int(0, 3) }, () => randomValue(random, depth + 1))
  }
  const record: Record<string, unknown> = {}
  const keyCount = random.int(0, 3)
  for (let index = 0; index < keyCount; index += 1) record[random.pick(NESTED_KEYS)] = randomValue(random, depth + 1)
  return record
}

function randomCustomer(random: Random): unknown {
  if (random.chance(0.2)) return randomValue(random, 1)
  const customer: Record<string, unknown> = {}
  if (random.chance(0.7)) customer.name = random.pick(PRIMITIVES)
  if (random.chance(0.6)) customer.tier = random.pick(['gold', 'silver', null, 1, ''])
  if (random.chance(0.6)) {
    customer.address = random.chance(0.8) ? { city: random.pick(['Warsaw', 'Berlin', '', null]) } : random.pick(PRIMITIVES)
  }
  return customer
}

function randomItems(random: Random): unknown {
  if (random.chance(0.2)) return randomValue(random, 1)
  return Array.from({ length: random.int(0, 3) }, () => {
    if (random.chance(0.15)) return random.pick(PRIMITIVES)
    const item: Record<string, unknown> = {}
    if (random.chance(0.8)) item.qty = random.pick([0, 1, 5, '5', null, 2.5])
    if (random.chance(0.7)) item.sku = random.pick(['A-1', 'B-2', 'abc', ''])
    return item
  })
}

function randomFieldValue(random: Random, key: string): unknown {
  if (key === 'customer') return randomCustomer(random)
  if (key === 'items') return randomItems(random)
  if (key === 'tags') {
    return random.chance(0.8)
      ? Array.from({ length: random.int(0, 3) }, () => random.pick(['won', 'vip', 'abc', '', 'b']))
      : randomValue(random, 1)
  }
  return randomValue(random, 1)
}

function randomData(random: Random): unknown {
  if (random.chance(0.03)) return random.pick<unknown>([null, undefined, 0, '', 'abc', [1, 2], true])
  const data: Record<string, unknown> = {}
  for (const key of TOP_KEYS) {
    if (random.chance(0.6)) data[key] = randomFieldValue(random, key)
  }
  return data
}

function randomContext(random: Random): EvaluationContext {
  const context: EvaluationContext = { user: { id: random.pick(['u1', 'u2']) }, tenant: { id: 't1' } }
  if (random.chance(0.3)) context.now = new Date('2026-10-10T08:00:00.000Z')
  if (random.chance(0.3)) context.today = new Date('2026-10-10T00:00:00.000Z')
  if (random.chance(0.4)) context.evaluatedAt = new Date('2026-01-01T12:00:00.000Z')
  return context
}

function randomStaticValue(random: Random, operator: ComparisonOperator): unknown {
  if (operator === 'MATCHES') {
    if (random.chance(0.1)) return random.pick(REJECTED_PATTERNS)
    return random.chance(0.9) ? random.pick(SAFE_PATTERNS) : random.pick(PRIMITIVES)
  }
  if ((operator === 'IN' || operator === 'NOT_IN') && random.chance(0.85)) {
    return Array.from({ length: random.int(0, 4) }, () =>
      random.chance(0.15) ? random.pick(SPECIAL_VALUES) : random.pick(PRIMITIVES))
  }
  if (random.chance(0.2)) return random.pick(SPECIAL_VALUES)
  return random.chance(0.9) ? random.pick(PRIMITIVES) : randomValue(random, 1)
}

function randomSimpleCondition(random: Random, faultRate: number): ConditionExpression {
  const operator = random.chance(faultRate * 1.5) ? ('BETWEEN' as unknown as ComparisonOperator) : random.pick(OPERATORS)
  const field = random.chance(faultRate) ? (42 as unknown as string) : random.pick(FIELD_PATHS)
  if (random.chance(0.25)) {
    const valueField = random.chance(0.05) ? '' : random.pick(FIELD_PATHS)
    return { field, operator, value: randomStaticValue(random, operator), valueField }
  }
  return { field, operator, value: randomStaticValue(random, operator) }
}

function randomExpression(random: Random, depth: number, faultRate = 0.01): ConditionExpression {
  if (depth < 4 && random.chance(depth === 0 ? 0.6 : 0.35)) {
    const operator = random.chance(faultRate * 2) ? ('XOR' as unknown as LogicalOperator) : random.pick(LOGICAL_OPERATORS)
    const ruleCount = random.pick([0, 1, 1, 2, 2, 3])
    const rules = Array.from({ length: ruleCount }, () =>
      random.chance(faultRate) ? (null as unknown as ConditionExpression) : randomExpression(random, depth + 1, faultRate))
    return { operator, rules }
  }
  return randomSimpleCondition(random, faultRate)
}

const ABSTRACT_TRUE: ConditionExpression = { field: 'known', operator: '=', value: true }
const ABSTRACT_FALSE: ConditionExpression = { field: 'known', operator: '=', value: false }
const ABSTRACT_ERROR: ConditionExpression = { field: 'known', operator: 'BOOM' as unknown as ComparisonOperator, value: true }
const ABSTRACT_UNKNOWN_FIELDS: readonly string[] = ['u0', 'u1', 'u2']

function randomAbstractExpression(random: Random, depth: number): ConditionExpression {
  if (depth < 4 && random.chance(depth === 0 ? 0.9 : 0.45)) {
    const rules = Array.from({ length: random.int(1, 3) }, () => randomAbstractExpression(random, depth + 1))
    return { operator: random.pick(LOGICAL_OPERATORS), rules }
  }
  const roll = random.next()
  if (roll < 0.15) return ABSTRACT_TRUE
  if (roll < 0.3) return ABSTRACT_FALSE
  if (roll < 0.5) return ABSTRACT_ERROR
  return { field: random.pick(ABSTRACT_UNKNOWN_FIELDS), operator: '=', value: true }
}

function abstractCompletions(): Record<string, boolean>[] {
  return Array.from({ length: 2 ** ABSTRACT_UNKNOWN_FIELDS.length }, (_unused, mask) => {
    const completion: Record<string, boolean> = { known: true }
    ABSTRACT_UNKNOWN_FIELDS.forEach((field, bit) => {
      completion[field] = (mask & (1 << bit)) !== 0
    })
    return completion
  })
}

type Outcome = { threw: true } | { threw: false; value: TriBoolean }

function capture(run: () => TriBoolean): Outcome {
  try {
    return { threw: false, value: run() }
  } catch {
    return { threw: true }
  }
}

function describeOutcome(outcome: Outcome): string {
  return outcome.threw ? 'throws' : String(outcome.value)
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => cloneValue(item))
  if (value !== null && typeof value === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) copy[key] = cloneValue(item)
    return copy
  }
  return value
}

function pathSegments(path: string): string[] {
  return path.replace(/\[(\d+)\]/g, '.$1').split('.')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function parentOf(data: unknown, segments: readonly string[]): unknown {
  let current = data
  for (const segment of segments.slice(0, -1)) {
    if (current === null || typeof current !== 'object' || PROTOTYPE_KEYS.has(segment)) return undefined
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function replaceAt(data: unknown, path: string, produce: () => unknown, allowDelete: boolean, random: Random): void {
  const segments = pathSegments(path)
  const key = segments[segments.length - 1]
  if (PROTOTYPE_KEYS.has(key)) return
  const parent = parentOf(data, segments)
  if (Array.isArray(parent)) {
    if (!/^\d+$/.test(key) || Number(key) >= parent.length) return
    parent[Number(key)] = produce()
    return
  }
  if (!isPlainRecord(parent)) return
  if (allowDelete && random.chance(0.25)) {
    delete parent[key]
    return
  }
  parent[key] = produce()
}

function completionsOf(data: unknown, paths: readonly string[], random: Random, count: number): unknown[] {
  const completions: unknown[] = [data]
  for (let index = 0; index < count; index += 1) {
    const completion = cloneValue(data)
    for (const path of paths) replaceAt(completion, path, () => randomValue(random, 1), true, random)
    completions.push(completion)
  }
  return completions
}

function collectPaths(value: unknown, prefix: string, depth: number, into: string[]): void {
  if (depth > 4 || value === null || typeof value !== 'object') return
  const entries = Array.isArray(value)
    ? value.map((item, index) => [String(index), item] as const)
    : Object.entries(value)
  for (const [key, item] of entries) {
    const path = prefix ? `${prefix}.${key}` : key
    into.push(path)
    collectPaths(item, path, depth + 1, into)
  }
}

type Mismatch = { index: number; expression: string; data: string; detail: string }

function serialize(value: unknown): string {
  return JSON.stringify(value, (_key, item) => (item === undefined ? '__undefined__' : item))
}

function checkSoundness(
  mismatches: Mismatch[],
  index: number,
  expression: ConditionExpression,
  context: EvaluationContext,
  tri: Outcome,
  completions: readonly unknown[],
): void {
  for (const completion of completions) {
    const production = capture(() => evaluateExpression(expression, completion, context))
    const sound = tri.threw ? production.threw : !production.threw && production.value === tri.value
    if (!sound) {
      mismatches.push({
        index,
        expression: serialize(expression),
        data: serialize(completion),
        detail: `tri ${describeOutcome(tri)} vs production ${describeOutcome(production)}`,
      })
    }
  }
}

describe('evaluateExpressionTri parity with evaluateExpression', () => {
  beforeAll(() => {
    jest.useFakeTimers({ now: FROZEN_NOW, doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
  })

  afterAll(() => {
    jest.useRealTimers()
  })

  test('matches production exactly on fully known inputs (4000 generated cases)', () => {
    const random = createRandom(0x5eed01)
    const mismatches: Mismatch[] = []
    const totals = { compared: 0, threw: 0, trueResults: 0, falseResults: 0, regexRejected: 0 }
    const operatorsSeen = new Set<string>()
    for (let index = 0; index < 4000; index += 1) {
      const expression = randomExpression(random, 0)
      const data = randomData(random)
      const context = randomContext(random)
      for (const operator of serialize(expression).match(/"operator":"[^"]+"/g) ?? []) operatorsSeen.add(operator)
      const production = capture(() => evaluateExpression(expression, data, context))
      const tri = capture(() => evaluateExpressionTri(expression, data, context))
      if (!tri.threw && tri.value === 'unknown') {
        const conditions = evaluateConditionsTri(expression, data, context)
        if (conditions.reason !== 'regex_rejected') {
          mismatches.push({ index, expression: serialize(expression), data: serialize(data), detail: `unexpected unknown (${conditions.reason})` })
        }
        totals.regexRejected += 1
        continue
      }
      totals.compared += 1
      if (production.threw) totals.threw += 1
      else if (production.value === true) totals.trueResults += 1
      else totals.falseResults += 1
      if (describeOutcome(tri) !== describeOutcome(production)) {
        mismatches.push({
          index,
          expression: serialize(expression),
          data: serialize(data),
          detail: `tri ${describeOutcome(tri)} vs production ${describeOutcome(production)}`,
        })
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([])
    expect(totals.compared).toBeGreaterThan(3800)
    expect(totals.threw).toBeGreaterThan(20)
    expect(totals.trueResults).toBeGreaterThan(500)
    expect(totals.falseResults).toBeGreaterThan(500)
    expect(totals.regexRejected).toBeGreaterThan(0)
    expect(totals.regexRejected).toBeLessThan(200)
    for (const operator of [...OPERATORS, ...LOGICAL_OPERATORS]) {
      expect(operatorsSeen.has(`"operator":"${operator}"`)).toBe(true)
    }
  })

  test('evaluateConditionsTri agrees with evaluateConditions on fully known inputs (1500 generated cases)', async () => {
    const random = createRandom(0x5eed02)
    const mismatches: Mismatch[] = []
    for (let index = 0; index < 1500; index += 1) {
      const conditions = random.chance(0.03) ? random.pick<unknown>([null, undefined, 0, '']) : randomExpression(random, 0)
      const data = randomData(random)
      const context = randomContext(random)
      const tri = evaluateConditionsTri(conditions, data, context)
      if (tri.outcome === 'unknown') {
        if (tri.reason !== 'regex_rejected') {
          mismatches.push({ index, expression: serialize(conditions), data: serialize(data), detail: `unexpected unknown (${tri.reason})` })
        }
        continue
      }
      let production: string
      try {
        production = String(await evaluateConditions(conditions, data, context))
      } catch {
        production = 'error'
      }
      if (production !== tri.outcome) {
        mismatches.push({ index, expression: serialize(conditions), data: serialize(data), detail: `tri ${tri.outcome} vs production ${production}` })
      }
    }
    expect(mismatches.slice(0, 5)).toEqual([])
  })

  test('is sound for declared unknown paths: a definite answer holds for every completion (3000 generated cases)', () => {
    const random = createRandom(0x5eed03)
    const mismatches: Mismatch[] = []
    const totals = { definite: 0, unknown: 0, threw: 0 }
    for (let index = 0; index < 3000; index += 1) {
      const expression = randomExpression(random, 0)
      const data = randomData(random)
      const context = randomContext(random)
      const unknownPaths = Array.from({ length: random.int(1, 2) }, () => random.pick(UNKNOWN_PATH_POOL))
      const tri = capture(() => evaluateExpressionTri(expression, data, context, { unknownPaths }))
      if (!tri.threw && tri.value === 'unknown') {
        totals.unknown += 1
        continue
      }
      if (tri.threw) totals.threw += 1
      else totals.definite += 1
      checkSoundness(mismatches, index, expression, context, tri, completionsOf(data, unknownPaths, random, 4))
    }
    expect(mismatches.slice(0, 5)).toEqual([])
    expect(totals.unknown).toBeGreaterThan(300)
    expect(totals.definite).toBeGreaterThan(1000)
  })

  test('stays sound when evaluation errors hide behind unknown inputs (3000 generated fault-heavy cases)', () => {
    const random = createRandom(0x5eed05)
    const mismatches: Mismatch[] = []
    const totals = { definite: 0, unknown: 0, threw: 0 }
    for (let index = 0; index < 3000; index += 1) {
      const expression = randomExpression(random, 0, 0.12)
      const data = randomData(random)
      const context = randomContext(random)
      const unknownPaths = Array.from({ length: random.int(1, 3) }, () => random.pick(UNKNOWN_PATH_POOL))
      const tri = capture(() => evaluateExpressionTri(expression, data, context, { unknownPaths }))
      if (!tri.threw && tri.value === 'unknown') {
        totals.unknown += 1
        continue
      }
      if (tri.threw) totals.threw += 1
      else totals.definite += 1
      checkSoundness(mismatches, index, expression, context, tri, completionsOf(data, unknownPaths, random, 4))
    }
    expect(mismatches.slice(0, 5)).toEqual([])
    expect(totals.threw).toBeGreaterThan(300)
    expect(totals.unknown).toBeGreaterThan(150)
  })

  test('is sound against every completion of abstract leaves and exact when each unknown occurs once (3000 generated trees)', () => {
    const random = createRandom(0x5eed06)
    const mismatches: Mismatch[] = []
    const totals = { definite: 0, unknown: 0, threw: 0, independent: 0 }
    const completions = abstractCompletions()
    const context: EvaluationContext = {}
    for (let index = 0; index < 3000; index += 1) {
      const expression = randomAbstractExpression(random, 0)
      const tri = capture(() =>
        evaluateExpressionTri(expression, completions[completions.length - 1], context, { unknownPaths: ABSTRACT_UNKNOWN_FIELDS }))
      if (!tri.threw && tri.value === 'unknown') totals.unknown += 1
      else if (tri.threw) totals.threw += 1
      else totals.definite += 1
      const serialized = serialize(expression)
      const independent = ABSTRACT_UNKNOWN_FIELDS.every((field) => serialized.split(`"field":"${field}"`).length <= 2)
      if (independent) {
        totals.independent += 1
        const outcomes = new Set(completions.map((completion) =>
          describeOutcome(capture(() => evaluateExpression(expression, completion, context)))))
        const expected = outcomes.size === 1 ? [...outcomes][0] : 'unknown'
        if (describeOutcome(tri) !== expected) {
          mismatches.push({ index, expression: serialized, data: 'all completions', detail: `tri ${describeOutcome(tri)} vs exact ${expected}` })
        }
      }
      if (!tri.threw && tri.value === 'unknown') continue
      checkSoundness(mismatches, index, expression, context, tri, completions)
    }
    expect(mismatches.slice(0, 5)).toEqual([])
    expect(totals.definite).toBeGreaterThan(300)
    expect(totals.unknown).toBeGreaterThan(300)
    expect(totals.threw).toBeGreaterThan(300)
    expect(totals.independent).toBeGreaterThan(1000)
  })

  test('is sound for redaction sentinels on the path, on ancestors and inside values (3000 generated cases)', () => {
    const random = createRandom(0x5eed04)
    const mismatches: Mismatch[] = []
    const totals = { definite: 0, unknown: 0 }
    for (let index = 0; index < 3000; index += 1) {
      const expression = randomExpression(random, 0)
      const data = randomData(random)
      const context = randomContext(random)
      const available: string[] = []
      collectPaths(data, '', 0, available)
      if (available.length === 0) continue
      const redactedPaths = Array.from({ length: random.int(1, 2) }, () => random.pick(available))
      const redacted = cloneValue(data)
      for (const path of redactedPaths) {
        replaceAt(redacted, path, () => random.pick(RULE_LOG_REDACTION_SENTINELS), false, random)
      }
      const tri = capture(() => evaluateExpressionTri(expression, redacted, context))
      if (!tri.threw && tri.value === 'unknown') {
        totals.unknown += 1
        continue
      }
      totals.definite += 1
      checkSoundness(mismatches, index, expression, context, tri, completionsOf(data, redactedPaths, random, 3))
    }
    expect(mismatches.slice(0, 5)).toEqual([])
    expect(totals.unknown).toBeGreaterThan(200)
    expect(totals.definite).toBeGreaterThan(1000)
  })
})

describe('evaluateExpressionTri operator table', () => {
  const context: EvaluationContext = {
    user: { id: 'u1' },
    now: new Date('2026-10-10T08:00:00.000Z'),
    today: new Date('2026-10-10T00:00:00.000Z'),
  }
  const table: ReadonlyArray<[ComparisonOperator, unknown, unknown, boolean]> = [
    ['=', 'won', 'won', true],
    ['=', 10, '10', true],
    ['=', null, undefined, true],
    ['=', 'Won', 'won', false],
    ['==', '10', 10, true],
    ['==', 0, null, false],
    ['!=', 'won', 'lost', true],
    ['!=', 5, '5', false],
    ['>', 10, 5, true],
    ['>', '2026-02-01', '2026-01-31', true],
    ['>', null, 1, false],
    ['>=', 5, 5, true],
    ['>=', 'abc', 'abd', false],
    ['<', '9', '10', true],
    ['<', 1, null, false],
    ['<=', 3, 3, true],
    ['<=', 4, 3, false],
    ['IN', 'won', ['won', 'lost'], true],
    ['IN', 5, ['5'], true],
    ['IN', 'won', 'won', false],
    ['NOT_IN', 'open', ['won', 'lost'], true],
    ['NOT_IN', 'won', ['won'], false],
    ['CONTAINS', ['vip', 'gold'], 'vip', true],
    ['CONTAINS', 'hello world', 'world', true],
    ['CONTAINS', { vip: true }, 'vip', false],
    ['NOT_CONTAINS', ['vip'], 'gold', true],
    ['NOT_CONTAINS', 'abc', 'b', false],
    ['STARTS_WITH', 'ORD-1', 'ORD', true],
    ['STARTS_WITH', null, 'ORD', false],
    ['ENDS_WITH', 'file.pdf', '.pdf', true],
    ['ENDS_WITH', 'file.pdf', '.png', false],
    ['MATCHES', 'abc123', '\\d+', true],
    ['MATCHES', 'abc', '^\\d+$', false],
    ['MATCHES', null, '.*', false],
    ['IS_EMPTY', '   ', null, true],
    ['IS_EMPTY', [], null, true],
    ['IS_EMPTY', { key: 1 }, null, false],
    ['IS_NOT_EMPTY', 0, null, true],
    ['IS_NOT_EMPTY', undefined, null, false],
  ]

  test.each(table)('%s with %j and %j evaluates to %s exactly like production', (operator, left, right, expected) => {
    const data = { left, right }
    const literal: ConditionExpression = { field: 'left', operator, value: right }
    const byField: ConditionExpression = { field: 'left', operator, value: null, valueField: 'right' }
    expect(evaluateExpression(literal, data, context)).toBe(expected)
    expect(evaluateExpressionTri(literal, data, context)).toBe(expected)
    expect(evaluateExpressionTri(byField, data, context)).toBe(evaluateExpression(byField, data, context))
  })

  test('covers every comparison operator', () => {
    expect(new Set(table.map(([operator]) => operator))).toEqual(new Set(OPERATORS))
  })

  test('resolves special values from the context like production', () => {
    const data = { day: '2026-10-10', at: '2026-10-10T08:00:00.000Z', owner: 'u1' }
    for (const [field, value] of [['day', '{{today}}'], ['at', '{{now}}'], ['owner', '{{user.id}}']] as const) {
      const expression: ConditionExpression = { field, operator: '=', value }
      expect(evaluateExpression(expression, data, context)).toBe(true)
      expect(evaluateExpressionTri(expression, data, context)).toBe(true)
    }
  })
})
