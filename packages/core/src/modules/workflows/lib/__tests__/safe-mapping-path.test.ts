import { afterEach } from '@jest/globals'
import { isSafeMappingPath, safeGetNestedValue, safeSetNestedValue } from '../safe-mapping-path'

describe('safe workflow mapping paths', () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).workflowPolluted
  })

  test.each([
    '__proto__.polluted',
    'nested.__proto__.polluted',
    'constructor.prototype.polluted',
    'nested.constructor.value',
    'nested.prototype.value',
  ])('rejects prototype-bearing target path %s', (path) => {
    expect(isSafeMappingPath(path)).toBe(false)
  })

  test('reads only safe own-property paths', () => {
    const inherited = { inherited: 'nope' }
    const source = Object.assign(Object.create(inherited), { own: { value: 42 } })

    expect(safeGetNestedValue(source, 'own.value')).toBe(42)
    expect(safeGetNestedValue(source, 'inherited')).toBeUndefined()
    expect(safeGetNestedValue(source, '__proto__')).toBeUndefined()
    expect(safeGetNestedValue(source, 'constructor.prototype')).toBeUndefined()
  })

  test('writes valid nested paths without following inherited properties', () => {
    const inherited = { inherited: { untouched: true } }
    const target = Object.create(inherited) as Record<string, unknown>

    expect(safeSetNestedValue(target, 'inherited.value', 42)).toBe(true)
    expect(target).toHaveProperty('inherited.value', 42)
    expect(target).not.toHaveProperty('inherited.untouched')
    expect(inherited).toEqual({ inherited: { untouched: true } })
  })

  test('does not mutate Object.prototype when a malicious path is supplied', () => {
    const target: Record<string, unknown> = {}

    expect(safeSetNestedValue(target, '__proto__.workflowPolluted', true)).toBe(false)
    expect(safeSetNestedValue(target, 'constructor.prototype.workflowPolluted', true)).toBe(false)
    expect(Object.prototype).not.toHaveProperty('workflowPolluted')
    expect(target).toEqual({})
  })

  test('clones mapped objects before descending so aliases cannot pollute prototypes', () => {
    const target: Record<string, unknown> = { alias: Object.prototype }

    expect(safeSetNestedValue(target, 'alias.workflowPolluted', true)).toBe(true)
    expect(Object.prototype).not.toHaveProperty('workflowPolluted')
    expect(target).toEqual({ alias: { workflowPolluted: true } })
  })
})
