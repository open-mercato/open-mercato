import { deriveDisplayName, isDerivedDisplayName } from '../displayName'

describe('deriveDisplayName', () => {
  it('joins first and last name with a single space', () => {
    expect(deriveDisplayName('John', 'Doe')).toBe('John Doe')
  })

  it('handles empty first name', () => {
    expect(deriveDisplayName('', 'Doe')).toBe('Doe')
  })

  it('handles empty last name', () => {
    expect(deriveDisplayName('John', '')).toBe('John')
  })

  it('trims surrounding whitespace from inputs', () => {
    expect(deriveDisplayName('  John  ', '  Doe  ')).toBe('John Doe')
  })

  it('returns empty string when both inputs are nullish', () => {
    expect(deriveDisplayName(null, null)).toBe('')
    expect(deriveDisplayName(undefined, undefined)).toBe('')
  })
})

describe('isDerivedDisplayName', () => {
  it('returns true when current matches derived value', () => {
    expect(isDerivedDisplayName('John Doe', 'John', 'Doe')).toBe(true)
  })

  it('returns false when current is a customized name', () => {
    expect(isDerivedDisplayName('Dr. K. Doe', 'John', 'Doe')).toBe(false)
  })

  it('treats empty current as derived', () => {
    expect(isDerivedDisplayName('', 'John', 'Doe')).toBe(true)
  })

  it('treats nullish current as derived', () => {
    expect(isDerivedDisplayName(null, 'John', 'Doe')).toBe(true)
    expect(isDerivedDisplayName(undefined, 'John', 'Doe')).toBe(true)
  })
})
