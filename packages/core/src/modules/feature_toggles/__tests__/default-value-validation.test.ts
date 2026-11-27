/** @jest-environment node */

import { describe, test, expect } from '@jest/globals'
import { toggleCreateSchema, toggleUpdateSchema } from '../data/validators'

const base = { identifier: 'checkout.express', name: 'Express checkout' }

describe('feature toggle default value validation', () => {
  test.each([
    ['boolean', false],
    ['string', ''],
    ['number', 0],
    ['json', {}],
  ])('create accepts a %s toggle with a falsy default value', (type, defaultValue) => {
    expect(toggleCreateSchema.safeParse({ ...base, type, defaultValue }).success).toBe(true)
  })

  test.each([
    ['null', { defaultValue: null }],
    ['missing', {}],
  ])('create rejects a %s default value on the defaultValue path', (_label, extra) => {
    const parsed = toggleCreateSchema.safeParse({ ...base, type: 'boolean', ...extra })
    expect(parsed.success).toBe(false)
    expect(parsed.error?.issues.map((issue) => issue.path.join('.'))).toEqual(['defaultValue'])
  })

  test('update keeps accepting a null or omitted default value', () => {
    const id = '0b6f0a52-1d1e-4f2a-9a4b-0f4d6a8e2c11'
    expect(toggleUpdateSchema.safeParse({ id, defaultValue: null }).success).toBe(true)
    expect(toggleUpdateSchema.safeParse({ id, name: 'Renamed' }).success).toBe(true)
  })
})
