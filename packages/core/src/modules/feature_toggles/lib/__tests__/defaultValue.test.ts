import { describe, expect, it } from '@jest/globals'
import { normalizeDefaultValueForType } from '../defaultValue'

describe('normalizeDefaultValueForType', () => {
  it('persists an untouched boolean default as an explicit false', () => {
    expect(normalizeDefaultValueForType('boolean', null)).toBe(false)
    expect(normalizeDefaultValueForType('boolean', undefined)).toBe(false)
  })

  it.each([
    [true, true],
    ['true', true],
    [false, false],
    ['false', false],
    ['leftover string from another type', false],
  ])('maps boolean %p to %p as the select displays it', (value, expected) => {
    expect(normalizeDefaultValueForType('boolean', value)).toBe(expected)
  })

  it('fills an unset string or number default with the value the field shows', () => {
    expect(normalizeDefaultValueForType('string', null)).toBe('')
    expect(normalizeDefaultValueForType('number', null)).toBe(0)
  })

  it('keeps chosen string and number defaults', () => {
    expect(normalizeDefaultValueForType('string', 'beta')).toBe('beta')
    expect(normalizeDefaultValueForType('number', 0)).toBe(0)
    expect(normalizeDefaultValueForType('number', 42)).toBe(42)
  })

  it('leaves json defaults untouched, null included', () => {
    const value = { rollout: 10 }
    expect(normalizeDefaultValueForType('json', value)).toBe(value)
    expect(normalizeDefaultValueForType('json', null)).toBeNull()
  })
})
