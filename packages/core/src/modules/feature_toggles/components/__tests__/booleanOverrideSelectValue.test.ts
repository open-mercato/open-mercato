/** @jest-environment node */

import { booleanOverrideSelectValue } from '../overrideFormConfig'

describe('booleanOverrideSelectValue (#2410)', () => {
  it('maps the boolean true to "true"', () => {
    expect(booleanOverrideSelectValue(true)).toBe('true')
  })

  it('maps the boolean false to "false"', () => {
    expect(booleanOverrideSelectValue(false)).toBe('false')
  })

  it('maps the string "true"/"false" through unchanged', () => {
    expect(booleanOverrideSelectValue('true')).toBe('true')
    expect(booleanOverrideSelectValue('false')).toBe('false')
  })

  it('falls back to "false" for undefined/null/other', () => {
    expect(booleanOverrideSelectValue(undefined)).toBe('false')
    expect(booleanOverrideSelectValue(null)).toBe('false')
    expect(booleanOverrideSelectValue('')).toBe('false')
  })
})
