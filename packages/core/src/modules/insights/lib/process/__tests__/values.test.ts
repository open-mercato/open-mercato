import {
  capActivityValue,
  comparableRawValue,
  isReservedActivityValue,
  sanitizeActivityValue,
  valueCapScope,
  type ValueCapState,
} from '../values'

const UUID = 'AAAAAAAA-0000-4000-8000-000000000001'

describe('sanitizeActivityValue', () => {
  it.each<[unknown, string]>([
    ['open', 'open'],
    ['in_fulfillment', 'in_fulfillment'],
    ['v1.2:beta-3', 'v1.2:beta-3'],
    [12, '12'],
    [true, 'true'],
    [UUID, UUID.toLowerCase()],
    ['  open  ', 'open'],
    [null, 'none'],
    [undefined, 'none'],
    ['', 'none'],
    ['Open', 'other'],
    ['Jan Kowalski', 'other'],
    ['jan@example.com', 'other'],
    ['a'.repeat(65), 'other'],
    [{ nested: true }, 'other'],
    [Number.NaN, 'other'],
  ])('maps %p to %p for dictionary fields', (input, expected) => {
    expect(sanitizeActivityValue(input, 'dictionary')).toBe(expected)
  })

  it('accepts UUIDs only for uuid and user fields', () => {
    expect(sanitizeActivityValue('open', 'uuid')).toBe('other')
    expect(sanitizeActivityValue('open', 'user')).toBe('other')
    expect(sanitizeActivityValue(UUID, 'user')).toBe(UUID.toLowerCase())
    expect(sanitizeActivityValue(null, 'uuid')).toBe('none')
  })
})

describe('comparableRawValue', () => {
  it('distinguishes different raw values that sanitize to the same token', () => {
    expect(comparableRawValue('Jan')).not.toBe(comparableRawValue('Anna'))
    expect(comparableRawValue(null)).toBe(comparableRawValue(undefined))
    expect(comparableRawValue('1')).not.toBe(comparableRawValue(1))
    expect(comparableRawValue({ a: 1 })).toBe(comparableRawValue({ a: 1 }))
  })
})

describe('capActivityValue', () => {
  it('keeps at most the configured number of distinct values per scope', () => {
    const state: ValueCapState = new Map()
    const scope = valueCapScope('test.deal', 'status')
    expect(capActivityValue(state, scope, 'a', 2)).toBe('a')
    expect(capActivityValue(state, scope, 'b', 2)).toBe('b')
    expect(capActivityValue(state, scope, 'a', 2)).toBe('a')
    expect(capActivityValue(state, scope, 'c', 2)).toBe('other')
    expect(capActivityValue(state, valueCapScope('test.deal', 'priority'), 'c', 2)).toBe('c')
  })

  it('never counts reserved values and honours values already stored', () => {
    const scope = valueCapScope('test.deal', 'status')
    const state: ValueCapState = new Map([[scope, { known: new Set(['stored']), distinct: 1 }]])
    expect(capActivityValue(state, scope, 'none', 1)).toBe('none')
    expect(capActivityValue(state, scope, 'other', 1)).toBe('other')
    expect(capActivityValue(state, scope, 'stored', 1)).toBe('stored')
    expect(capActivityValue(state, scope, 'fresh', 1)).toBe('other')
    expect(isReservedActivityValue('none')).toBe(true)
    expect(isReservedActivityValue('stored')).toBe(false)
  })

  it('caps at 200 distinct values by default', () => {
    const state: ValueCapState = new Map()
    const scope = valueCapScope('test.deal', 'stageId')
    for (let index = 0; index < 200; index += 1) {
      expect(capActivityValue(state, scope, `value_${index}`)).toBe(`value_${index}`)
    }
    expect(capActivityValue(state, scope, 'value_200')).toBe('other')
  })
})
