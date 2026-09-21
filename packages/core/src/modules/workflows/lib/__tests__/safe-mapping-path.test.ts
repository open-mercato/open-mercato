import { isSafeMappingTargetPath, safeSetNestedValue } from '../safe-mapping-path'

describe('safe workflow mapping paths', () => {
  test.each([
    '__proto__.polluted',
    'nested.__proto__.polluted',
    'constructor.prototype.polluted',
    'nested.constructor.value',
    'nested.prototype.value',
  ])('rejects prototype-bearing target path %s', (path) => {
    expect(isSafeMappingTargetPath(path)).toBe(false)
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
})
