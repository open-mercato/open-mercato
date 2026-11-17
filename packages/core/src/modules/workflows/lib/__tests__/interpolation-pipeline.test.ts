/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import {
  applyTransforms,
  interpolationTransformNames,
  parseInterpolationToken,
  type ParsedTransform,
} from '../interpolation-pipeline'

const parsed = (token: string) => {
  const result = parseInterpolationToken(token)
  if (!result.ok) throw new Error(`[internal] expected token to parse: ${result.error}`)
  return { path: result.path, transforms: result.transforms }
}

const parseError = (token: string): string => {
  const result = parseInterpolationToken(token)
  if (result.ok) throw new Error('[internal] expected token to fail parsing')
  return result.error
}

const applied = (value: unknown, transforms: ParsedTransform[]) => {
  const result = applyTransforms(value, transforms)
  if (!result.ok) throw new Error(`[internal] expected transforms to apply: ${result.error.message}`)
  return result.value
}

const applyError = (value: unknown, transforms: ParsedTransform[]) => {
  const result = applyTransforms(value, transforms)
  if (result.ok) throw new Error('[internal] expected transforms to fail')
  return result.error
}

describe('parseInterpolationToken', () => {
  test('pipe-free token parses to path with no transforms', () => {
    expect(parsed('context.user.name')).toEqual({ path: 'context.user.name', transforms: [] })
  })

  test('trims whitespace around the path like the legacy interpolator', () => {
    expect(parsed('  orderId  ')).toEqual({ path: 'orderId', transforms: [] })
  })

  test('keeps engine-provided paths untouched', () => {
    expect(parsed('workflow.instanceId').path).toBe('workflow.instanceId')
    expect(parsed('env.APP_URL').path).toBe('env.APP_URL')
    expect(parsed('now').path).toBe('now')
  })

  test('pipe-free token containing parentheses stays a literal path', () => {
    expect(parsed('some(odd)path')).toEqual({ path: 'some(odd)path', transforms: [] })
  })

  test('parses a bare transform without arguments', () => {
    expect(parsed('context.name | upper')).toEqual({
      path: 'context.name',
      transforms: [{ name: 'upper', args: [] }],
    })
  })

  test('parses a transform with an empty argument list', () => {
    expect(parsed('createdAt | date()')).toEqual({
      path: 'createdAt',
      transforms: [{ name: 'date', args: [] }],
    })
  })

  test('parses string, number, boolean, and null arguments', () => {
    expect(parsed(`value | number(2, "de-DE") | default('n/a') | pick(0) | default(true) | default(null)`).transforms).toEqual([
      { name: 'number', args: [2, 'de-DE'] },
      { name: 'default', args: ['n/a'] },
      { name: 'pick', args: [0] },
      { name: 'default', args: [true] },
      { name: 'default', args: [null] },
    ])
  })

  test('parses negative and decimal number arguments', () => {
    expect(parsed('value | number(2) | pick(-1)').transforms[1]).toEqual({ name: 'pick', args: [-1] })
    expect(parsed('value | default(1.5)').transforms[0]).toEqual({ name: 'default', args: [1.5] })
  })

  test('parses chained transforms in order', () => {
    expect(parsed(`context.deal.closeDate | date('yyyy-MM-dd') | concat('!')`).transforms).toEqual([
      { name: 'date', args: ['yyyy-MM-dd'] },
      { name: 'concat', args: ['!'] },
    ])
  })

  test('pipe inside a quoted argument is not a separator', () => {
    expect(parsed(`status | default('a|b')`).transforms).toEqual([
      { name: 'default', args: ['a|b'] },
    ])
  })

  test('comma inside a quoted argument is not a separator', () => {
    expect(parsed(`name | concat(', done')`).transforms).toEqual([
      { name: 'concat', args: [', done'] },
    ])
  })

  test('backslash escapes inside string arguments', () => {
    expect(parsed(`name | concat('it\\'s')`).transforms).toEqual([
      { name: 'concat', args: ["it's"] },
    ])
  })

  test('rejects an empty path', () => {
    expect(parseError('| upper')).toContain('empty interpolation path')
    expect(parseError('   ')).toContain('empty interpolation path')
  })

  test('rejects an empty transform segment', () => {
    expect(parseError('name |')).toContain('empty transform segment')
    expect(parseError('name | | upper')).toContain('empty transform segment')
  })

  test('rejects invalid transform names', () => {
    expect(parseError('name | 9bad')).toContain('invalid transform name')
    expect(parseError('name | up per')).toContain('invalid transform name')
  })

  test('rejects unbalanced quotes and parentheses', () => {
    expect(parseError(`name | concat('open`)).toContain('unbalanced')
    expect(parseError('name | upper(')).toContain('unbalanced')
    expect(parseError('name | upper)')).toContain('unbalanced')
  })

  test('rejects trailing characters after the argument list', () => {
    expect(parseError(`name | concat('a')x`)).toContain('unterminated arguments')
  })

  test('rejects non-literal arguments', () => {
    expect(parseError('name | concat(bare)')).toContain('invalid argument')
    expect(parseError('name | concat({})')).toContain('invalid argument')
  })
})

describe('applyTransforms', () => {
  test('empty transform list returns the value unchanged', () => {
    const value = { nested: true }
    expect(applied(value, [])).toBe(value)
  })

  test('upper, lower, and title on strings', () => {
    expect(applied('hello world', [{ name: 'upper', args: [] }])).toBe('HELLO WORLD')
    expect(applied('HELLO', [{ name: 'lower', args: [] }])).toBe('hello')
    expect(applied('hello BIG world', [{ name: 'title', args: [] }])).toBe('Hello Big World')
  })

  test('text transforms coerce numbers and booleans', () => {
    expect(applied(42, [{ name: 'concat', args: [' items'] }])).toBe('42 items')
    expect(applied(true, [{ name: 'upper', args: [] }])).toBe('TRUE')
  })

  test('text transforms reject objects and null', () => {
    expect(applyError({ a: 1 }, [{ name: 'upper', args: [] }]).code).toBe('invalid-input')
    expect(applyError(null, [{ name: 'lower', args: [] }]).code).toBe('invalid-input')
    expect(applyError(undefined, [{ name: 'upper', args: [] }]).code).toBe('invalid-input')
  })

  test('text transforms reject unexpected arguments', () => {
    expect(applyError('x', [{ name: 'upper', args: ['y'] }]).code).toBe('invalid-args')
  })

  test('concat appends and prepend prefixes', () => {
    expect(applied('order', [{ name: 'concat', args: ['-123'] }])).toBe('order-123')
    expect(applied('123', [{ name: 'prepend', args: ['order-'] }])).toBe('order-123')
  })

  test('date formats Date instances, ISO strings, and epoch numbers in UTC', () => {
    const date = new Date(Date.UTC(2026, 6, 27, 13, 5, 9, 42))
    expect(applied(date, [{ name: 'date', args: ['yyyy-MM-dd'] }])).toBe('2026-07-27')
    expect(applied('2026-07-27T13:05:09.042Z', [{ name: 'date', args: ['yyyy-MM-dd HH:mm:ss.SSS'] }])).toBe(
      '2026-07-27 13:05:09.042',
    )
    expect(applied(date.getTime(), [{ name: 'date', args: ['dd.MM.yyyy'] }])).toBe('27.07.2026')
  })

  test('date without a format returns the ISO string', () => {
    expect(applied('2026-07-27T00:00:00.000Z', [{ name: 'date', args: [] }])).toBe(
      '2026-07-27T00:00:00.000Z',
    )
  })

  test('date rejects non-date input and non-string format', () => {
    expect(applyError('not a date', [{ name: 'date', args: ['yyyy'] }]).code).toBe('invalid-input')
    expect(applyError(new Date(), [{ name: 'date', args: [5] }]).code).toBe('invalid-args')
  })

  test('number fixes decimals', () => {
    expect(applied(120.5, [{ name: 'number', args: [2] }])).toBe('120.50')
    expect(applied('3.14159', [{ name: 'number', args: [3] }])).toBe('3.142')
    expect(applied(7, [{ name: 'number', args: [] }])).toBe('7')
  })

  test('number formats locale-aware', () => {
    expect(applied(1234.5, [{ name: 'number', args: [2, 'de-DE'] }])).toBe('1.234,50')
  })

  test('number rejects non-numeric input and bad decimals', () => {
    expect(applyError('abc', [{ name: 'number', args: [2] }]).code).toBe('invalid-input')
    expect(applyError(1, [{ name: 'number', args: [-1] }]).code).toBe('invalid-args')
    expect(applyError(1, [{ name: 'number', args: ['two'] }]).code).toBe('invalid-args')
  })

  test('default applies to undefined, null, and empty string only', () => {
    expect(applied(undefined, [{ name: 'default', args: ['fallback'] }])).toBe('fallback')
    expect(applied(null, [{ name: 'default', args: ['fallback'] }])).toBe('fallback')
    expect(applied('', [{ name: 'default', args: ['fallback'] }])).toBe('fallback')
    expect(applied(0, [{ name: 'default', args: ['fallback'] }])).toBe(0)
    expect(applied(false, [{ name: 'default', args: ['fallback'] }])).toBe(false)
    expect(applied('kept', [{ name: 'default', args: ['fallback'] }])).toBe('kept')
  })

  test('pick reads object fields and array indexes', () => {
    expect(applied({ name: 'Ada' }, [{ name: 'pick', args: ['name'] }])).toBe('Ada')
    expect(applied(['first', 'second'], [{ name: 'pick', args: [1] }])).toBe('second')
    expect(applied({ a: 1 }, [{ name: 'pick', args: ['missing'] }])).toBeUndefined()
  })

  test('pick rejects scalar input', () => {
    expect(applyError('scalar', [{ name: 'pick', args: ['field'] }]).code).toBe('invalid-input')
  })

  test('pick then default covers missing fields', () => {
    expect(
      applied({ a: 1 }, [
        { name: 'pick', args: ['missing'] },
        { name: 'default', args: ['n/a'] },
      ]),
    ).toBe('n/a')
  })

  test('chained transforms fold left to right', () => {
    expect(
      applied({ user: { name: 'ada lovelace' } }, [
        { name: 'pick', args: ['user'] },
        { name: 'pick', args: ['name'] },
        { name: 'title', args: [] },
        { name: 'concat', args: [' (author)'] },
      ]),
    ).toBe('Ada Lovelace (author)')
  })

  test('unknown transform yields a typed error naming the transform', () => {
    const error = applyError('x', [{ name: 'nonsense', args: [] }])
    expect(error.code).toBe('unknown-transform')
    expect(error.transform).toBe('nonsense')
  })

  test('failure short-circuits the chain', () => {
    const error = applyError({ a: 1 }, [
      { name: 'upper', args: [] },
      { name: 'lower', args: [] },
    ])
    expect(error.code).toBe('invalid-input')
    expect(error.transform).toBe('upper')
  })
})

describe('transform table surface', () => {
  test('exposes the fixed transform names', () => {
    expect([...interpolationTransformNames]).toEqual(
      expect.arrayContaining(['date', 'number', 'upper', 'lower', 'title', 'concat', 'prepend', 'default', 'pick']),
    )
    expect(interpolationTransformNames).toHaveLength(9)
  })
})
