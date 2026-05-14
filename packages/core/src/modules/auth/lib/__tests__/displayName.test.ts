import { normalizeDisplayNameInput } from '@open-mercato/core/modules/auth/lib/displayName'

describe('normalizeDisplayNameInput', () => {
  it('returns null for blank strings', () => {
    expect(normalizeDisplayNameInput('')).toBeNull()
    expect(normalizeDisplayNameInput('   ')).toBeNull()
  })

  it('trims non-empty strings and preserves null', () => {
    expect(normalizeDisplayNameInput('  Ada Lovelace  ')).toBe('Ada Lovelace')
    expect(normalizeDisplayNameInput(null)).toBeNull()
  })

  it('preserves non-string values so validation can reject them', () => {
    expect(normalizeDisplayNameInput(123)).toBe(123)
    expect(normalizeDisplayNameInput({})).toEqual({})
  })
})
