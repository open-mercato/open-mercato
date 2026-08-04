import { describe, test, expect } from '@jest/globals'
import { getNestedValue, resolveSpecialValue } from '../value-resolver'
import type { EvaluationContext } from '../expression-evaluator'

describe('getNestedValue', () => {
  describe('legitimate field paths', () => {
    test('resolves a top-level own property', () => {
      expect(getNestedValue({ status: 'active' }, 'status')).toBe('active')
    })

    test('resolves a nested own property via dot notation', () => {
      expect(getNestedValue({ user: { name: 'Ada' } }, 'user.name')).toBe('Ada')
    })

    test('resolves array notation', () => {
      const data = { items: [{ quantity: 3 }, { quantity: 7 }] }
      expect(getNestedValue(data, 'items[0].quantity')).toBe(3)
      expect(getNestedValue(data, 'items[1].quantity')).toBe(7)
    })

    test('resolves array length and indexes', () => {
      const data = { values: [10, 20, 30] }
      expect(getNestedValue(data, 'values[2]')).toBe(30)
      expect(getNestedValue(data, 'values.length')).toBe(3)
    })

    test('returns undefined for a missing own property', () => {
      expect(getNestedValue({ user: { name: 'Ada' } }, 'user.email')).toBeUndefined()
    })

    test('returns undefined for empty object or path', () => {
      expect(getNestedValue(null, 'status')).toBeUndefined()
      expect(getNestedValue({ status: 'active' }, '')).toBeUndefined()
    })

    test('resolves falsy own values rather than treating them as missing', () => {
      const data = { count: 0, flag: false, label: '' }
      expect(getNestedValue(data, 'count')).toBe(0)
      expect(getNestedValue(data, 'flag')).toBe(false)
      expect(getNestedValue(data, 'label')).toBe('')
    })
  })

  describe('prototype key rejection', () => {
    test('rejects a __proto__ segment', () => {
      expect(getNestedValue({ user: { name: 'Ada' } }, '__proto__')).toBeUndefined()
    })

    test('rejects the issue-reported __proto__.polluted path', () => {
      expect(getNestedValue({ user: { name: 'Ada' } }, '__proto__.polluted')).toBeUndefined()
    })

    test('rejects a constructor segment', () => {
      expect(getNestedValue({ user: { name: 'Ada' } }, 'constructor')).toBeUndefined()
    })

    test('rejects a nested constructor.prototype path', () => {
      expect(getNestedValue({ user: { name: 'Ada' } }, 'constructor.prototype')).toBeUndefined()
    })

    test('rejects a prototype segment', () => {
      expect(getNestedValue({ user: { name: 'Ada' } }, 'prototype')).toBeUndefined()
    })

    test('rejects a prototype key reached mid-path', () => {
      expect(getNestedValue({ user: { name: 'Ada' } }, 'user.__proto__')).toBeUndefined()
      expect(getNestedValue({ user: { name: 'Ada' } }, 'user.__proto__.polluted')).toBeUndefined()
    })

    test('does not leak a value assigned onto the prototype chain', () => {
      const base = { inheritedSecret: 'leaked' }
      const data = Object.create(base) as Record<string, unknown>
      data.own = 'visible'

      expect(getNestedValue(data, 'own')).toBe('visible')
      expect(getNestedValue(data, 'inheritedSecret')).toBeUndefined()
    })
  })

  describe('inherited property rejection', () => {
    test('rejects built-in inherited members', () => {
      const data = { user: { name: 'Ada' } }
      expect(getNestedValue(data, 'toString')).toBeUndefined()
      expect(getNestedValue(data, 'hasOwnProperty')).toBeUndefined()
      expect(getNestedValue(data, 'user.valueOf')).toBeUndefined()
    })

    test('rejects inherited array members', () => {
      expect(getNestedValue({ values: [1, 2] }, 'values.map')).toBeUndefined()
    })
  })
})

describe('resolveSpecialValue', () => {
  const context: EvaluationContext = {
    user: { id: 'user-1', email: 'ada@example.com' },
    tenant: { id: 'tenant-1' },
    today: new Date('2026-07-25T12:00:00.000Z'),
    now: new Date('2026-07-25T12:00:00.000Z'),
  }

  test('resolves {{today}} and {{now}}', () => {
    expect(resolveSpecialValue('{{today}}', context)).toBe('2026-07-25')
    expect(resolveSpecialValue('{{now}}', context)).toBe('2026-07-25T12:00:00.000Z')
  })

  test('resolves legitimate context paths', () => {
    expect(resolveSpecialValue('{{user.id}}', context)).toBe('user-1')
    expect(resolveSpecialValue('{{tenant.id}}', context)).toBe('tenant-1')
  })

  test('rejects prototype key templates', () => {
    expect(resolveSpecialValue('{{__proto__}}', context)).toBeUndefined()
    expect(resolveSpecialValue('{{__proto__.polluted}}', context)).toBeUndefined()
    expect(resolveSpecialValue('{{constructor.prototype}}', context)).toBeUndefined()
    expect(resolveSpecialValue('{{user.__proto__}}', context)).toBeUndefined()
  })
})
