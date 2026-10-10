jest.mock('../workflow-executor', () => ({
  executeWorkflow: jest.fn(),
  startWorkflow: jest.fn(),
}))

import { createHash } from 'node:crypto'
import type { TriggerFilterCondition, TriggerFilterOperator } from '../../data/entities'
import { evaluateFilterConditions, mapEventToContext } from '../event-trigger-service'
import {
  compareTriggerFilterValue,
  constantTriggerFilterResult,
  getTriggerPayloadValue,
  readOwnTriggerPayloadPath,
} from '../trigger-filter'
import { evaluateFilterConditionsTri, isUnknownTriggerPayloadPath } from '../simulation/trigger-filter-tri'

const OPERATORS: TriggerFilterOperator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith', 'in', 'notIn', 'exists', 'notExists', 'regex']

const EXPECTED_VALUES: unknown[] = [
  'won', 'w', 'on', '', '^w.n$', '(a+)+b', '[', 5, 0, -1, 2.5, true, false, null, undefined,
  ['won', 'lost'], [], [5, 'x'], { nested: true },
]

const PAYLOAD_VALUES: unknown[] = [
  'won', 'lost', 'WON', '', 5, 0, 10, -3, true, false, null, undefined, ['won', 'x'], [], [5], { nested: true }, 'a'.repeat(20),
]

const FIELDS = ['status', 'meta.kind', 'items.0', 'items.length', 'missing', 'missing.deeper', 'status.length', 'a..b']

function payloadWith(value: unknown): Record<string, unknown> {
  return {
    id: 'deal-1',
    status: value,
    meta: { kind: value },
    items: [value, 'second'],
    'a': { '': { b: value } },
  }
}

describe('production filter behaviour is frozen across the move to lib/trigger-filter.ts', () => {
  const GOLDEN_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith', 'endsWith', 'in', 'notIn', 'exists', 'notExists', 'regex', 'unknownOp']
  const GOLDEN_EXPECTED: unknown[] = ['won', 'w', 'on', '', '^w.n$', '(a+)+b', '[', '^a+$', 5, 0, -1, 2.5, true, false, null, undefined, ['won', 'lost'], [], [5, 'x'], { nested: true }]
  const GOLDEN_VALUES: unknown[] = ['won', 'lost', 'WON', '', 5, 0, 10, -3, true, false, null, undefined, ['won', 'x'], [], [5], { nested: true }, 'a'.repeat(20), 'a'.repeat(10_001)]
  const GOLDEN_FIELDS = ['status', 'meta.kind', 'items.0', 'items.length', 'missing', 'missing.deeper', 'status.length', 'a..b', 'constructor', 'toString', '__proto__', 'items.map']

  it('reproduces the outcomes of the pre-move evaluateFilterConditions (sha256 captured from HEAD 909ffd0eb)', () => {
    let bits = ''
    for (const operator of GOLDEN_OPERATORS) for (const expected of GOLDEN_EXPECTED) for (const field of GOLDEN_FIELDS) for (const value of GOLDEN_VALUES) {
      bits += evaluateFilterConditions([{ field, operator: operator as TriggerFilterOperator, value: expected }], payloadWith(value)) ? '1' : '0'
    }
    expect(bits).toHaveLength(64_800)
    expect(createHash('sha256').update(bits).digest('hex')).toBe('5d54177a42125a186f433945b4a4e8916193d71e7fc68414ffe39a0038cec206')
  })
})

describe('trigger filter parity with production (fully known inputs)', () => {
  it('answers exactly what evaluateFilterConditions answers for every operator, field and value', () => {
    let compared = 0
    for (const operator of OPERATORS) {
      for (const expected of EXPECTED_VALUES) {
        for (const field of FIELDS) {
          for (const value of PAYLOAD_VALUES) {
            const conditions: TriggerFilterCondition[] = [{ field, operator, value: expected }]
            const payload = payloadWith(value)
            const production = evaluateFilterConditions(conditions, payload)
            const simulated = evaluateFilterConditionsTri(conditions, payload)
            expect({ operator, expected, field, value, outcome: simulated.outcome }).toEqual({ operator, expected, field, value, outcome: production ? 'true' : 'false' })
            compared += 1
          }
        }
      }
    }
    expect(compared).toBe(OPERATORS.length * EXPECTED_VALUES.length * FIELDS.length * PAYLOAD_VALUES.length)
  })

  it('combines conditions with AND exactly as production, including no conditions at all', () => {
    const payload = { status: 'won', amount: 10 }
    const cases: TriggerFilterCondition[][] = [
      [],
      [{ field: 'status', operator: 'eq', value: 'won' }, { field: 'amount', operator: 'gt', value: 5 }],
      [{ field: 'status', operator: 'eq', value: 'won' }, { field: 'amount', operator: 'gt', value: 50 }],
      [{ field: 'status', operator: 'neq', value: 'won' }, { field: 'amount', operator: 'gt', value: 5 }],
    ]
    for (const conditions of cases) {
      expect(evaluateFilterConditionsTri(conditions, payload).outcome).toBe(evaluateFilterConditions(conditions, payload) ? 'true' : 'false')
    }
    expect(evaluateFilterConditionsTri(undefined, payload).outcome).toBe('true')
    expect(evaluateFilterConditions(undefined, payload)).toBe(true)
  })

  it('keeps the production accessor and context mapping unchanged (prototype members are read in production)', () => {
    expect(getTriggerPayloadValue({ a: { b: 1 } }, 'a.b')).toBe(1)
    expect(getTriggerPayloadValue({ a: 'text' }, 'a.length')).toBeUndefined()
    expect(getTriggerPayloadValue({ items: [1, 2] }, 'items.length')).toBe(2)
    expect(typeof getTriggerPayloadValue({}, 'constructor')).toBe('function')
    expect(evaluateFilterConditions([{ field: 'constructor', operator: 'exists', value: null }], {})).toBe(true)
    expect(mapEventToContext([{ targetKey: 'status', sourceExpression: 'deal.status', defaultValue: 'open' }], { deal: {} })).toEqual({ status: 'open' })
  })
})

describe('own-property payload accessor', () => {
  it('reads own paths like production and reports absent paths as production undefined', () => {
    const payload = JSON.parse('{"id":"deal-1","meta":{"kind":"x"},"items":[{"name":"first"}],"constructor":"own value","empty":null}') as Record<string, unknown>
    expect(readOwnTriggerPayloadPath(payload, 'meta.kind')).toEqual({ status: 'found', value: 'x' })
    expect(readOwnTriggerPayloadPath(payload, 'items.0.name')).toEqual({ status: 'found', value: 'first' })
    expect(readOwnTriggerPayloadPath(payload, 'items.length')).toEqual({ status: 'found', value: 1 })
    expect(readOwnTriggerPayloadPath(payload, 'constructor')).toEqual({ status: 'found', value: 'own value' })
    expect(readOwnTriggerPayloadPath(payload, 'missing')).toEqual({ status: 'absent' })
    expect(readOwnTriggerPayloadPath(payload, 'empty.inner')).toEqual({ status: 'absent' })
    expect(readOwnTriggerPayloadPath(payload, 'id.length')).toEqual({ status: 'absent' })
    for (const path of ['meta.kind', 'items.0.name', 'items.length', 'constructor', 'missing', 'empty.inner', 'id.length']) {
      const read = readOwnTriggerPayloadPath(payload, path)
      expect(read.status === 'found' ? read.value : undefined).toBe(getTriggerPayloadValue(payload, path))
    }
  })

  it('rejects paths through members inherited from the prototype chain', () => {
    const payload = { id: 'deal-1', items: ['a'], meta: {} } as Record<string, unknown>
    for (const path of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'meta.constructor', 'items.map', 'constructor.name', '__proto__.polluted']) {
      expect({ path, read: readOwnTriggerPayloadPath(payload, path) }).toEqual({ path, read: { status: 'inherited' } })
    }
  })

  it('makes a condition on a prototype path cannot-tell unless its result cannot depend on the value', () => {
    const payload = { status: 'won' }
    expect(evaluateFilterConditionsTri([{ field: 'constructor', operator: 'exists', value: null }], payload)).toEqual({ outcome: 'unknown', reasons: ['prototype_path'] })
    expect(evaluateFilterConditionsTri([{ field: 'constructor.name', operator: 'eq', value: 'Object' }], payload)).toEqual({ outcome: 'unknown', reasons: ['prototype_path'] })
    expect(evaluateFilterConditionsTri([{ field: 'toString', operator: 'gt', value: 'x' }], payload)).toEqual({ outcome: 'false', reasons: [] })
    expect(evaluateFilterConditionsTri([{ field: 'constructor', operator: 'exists', value: null }, { field: 'status', operator: 'eq', value: 'lost' }], payload)).toEqual({ outcome: 'false', reasons: [] })
  })
})

describe('unknown payload paths', () => {
  it('match the path itself, its descendants and its ancestors', () => {
    expect(isUnknownTriggerPayloadPath('valueAmount', ['valueAmount'])).toBe(true)
    expect(isUnknownTriggerPayloadPath('meta.kind', ['meta'])).toBe(true)
    expect(isUnknownTriggerPayloadPath('meta', ['meta.kind'])).toBe(true)
    expect(isUnknownTriggerPayloadPath('metadata', ['meta'])).toBe(false)
    expect(isUnknownTriggerPayloadPath('status', [])).toBe(false)
  })

  it('make conditions cannot-tell; a known false condition still decides the filter', () => {
    const payload = { id: 'deal-1', status: 'won' }
    expect(evaluateFilterConditionsTri([{ field: 'valueAmount', operator: 'gt', value: 100 }], payload, { unknownPaths: ['valueAmount'] })).toEqual({ outcome: 'unknown', reasons: ['unknown_path'] })
    expect(evaluateFilterConditionsTri([{ field: 'valueAmount', operator: 'gt', value: 100 }, { field: 'status', operator: 'eq', value: 'lost' }], payload, { unknownPaths: ['valueAmount'] })).toEqual({ outcome: 'false', reasons: [] })
    expect(evaluateFilterConditionsTri([{ field: 'valueAmount', operator: 'gt', value: 100 }, { field: 'status', operator: 'eq', value: 'won' }], payload, { unknownPaths: ['valueAmount'] }).outcome).toBe('unknown')
    expect(evaluateFilterConditionsTri([{ field: 'valueAmount', operator: 'gt', value: '100' }], payload, { unknownPaths: ['valueAmount'] })).toEqual({ outcome: 'false', reasons: [] })
    expect(evaluateFilterConditionsTri([{ field: 'valueAmount', operator: 'notIn', value: [] }], payload, { unknownPaths: ['valueAmount'] })).toEqual({ outcome: 'true', reasons: [] })
  })
})

describe('constant filter results', () => {
  const PROBES: unknown[] = [...PAYLOAD_VALUES, Number.NaN, 'won-and-more', 'x'.repeat(10_001)]

  it('hold for every probed value whenever they claim a constant', () => {
    let constants = 0
    for (const operator of OPERATORS) {
      for (const expected of [...EXPECTED_VALUES, Number.NaN, 'x'.repeat(201)]) {
        const constant = constantTriggerFilterResult(operator, expected)
        if (constant === null) continue
        constants += 1
        for (const value of PROBES) {
          expect({ operator, expected, value, result: compareTriggerFilterValue(operator, value, expected) }).toEqual({ operator, expected, value, result: constant })
        }
      }
    }
    expect(constants).toBeGreaterThan(20)
  })

  it('stay unknown when the value decides', () => {
    expect(constantTriggerFilterResult('eq', 'won')).toBeNull()
    expect(constantTriggerFilterResult('gt', 5)).toBeNull()
    expect(constantTriggerFilterResult('in', ['won'])).toBeNull()
    expect(constantTriggerFilterResult('regex', '^w.n$')).toBeNull()
    expect(constantTriggerFilterResult('exists', null)).toBeNull()
  })
})
