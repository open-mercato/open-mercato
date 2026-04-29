/** @jest-environment node */
import {
  deriveDisplayName,
  deriveDisplayNameFromEmail,
  isDerivedDisplayName,
} from '../displayName'

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

describe('deriveDisplayNameFromEmail', () => {
  it('splits dot-separated local-part into capitalised words', () => {
    expect(deriveDisplayNameFromEmail('john.doe@acme.com')).toBe('John Doe')
  })

  it('splits underscore-separated local-part', () => {
    expect(deriveDisplayNameFromEmail('piotr_wisniewski@om.pl')).toBe('Piotr Wisniewski')
  })

  it('splits hyphen-separated local-part', () => {
    expect(deriveDisplayNameFromEmail('maria-lewandowska@om.pl')).toBe('Maria Lewandowska')
  })

  it('splits plus-separated local-part', () => {
    expect(deriveDisplayNameFromEmail('tomasz+work@om.pl')).toBe('Tomasz Work')
  })

  it('returns a single capitalised word when there are no separators', () => {
    expect(deriveDisplayNameFromEmail('alice@example.com')).toBe('Alice')
  })

  it('preserves internal casing after the first letter', () => {
    expect(deriveDisplayNameFromEmail('maryAnn.smith@acme.com')).toBe('MaryAnn Smith')
  })

  it('returns null when input is null or undefined', () => {
    expect(deriveDisplayNameFromEmail(null)).toBeNull()
    expect(deriveDisplayNameFromEmail(undefined)).toBeNull()
  })

  it('returns null when input is empty or whitespace', () => {
    expect(deriveDisplayNameFromEmail('')).toBeNull()
    expect(deriveDisplayNameFromEmail('   ')).toBeNull()
  })

  it('returns null when local-part is empty (e.g. "@acme.com")', () => {
    expect(deriveDisplayNameFromEmail('@acme.com')).toBeNull()
  })

  it('treats a string without @ as a local-part', () => {
    expect(deriveDisplayNameFromEmail('jan.kowalski')).toBe('Jan Kowalski')
  })

  it('returns null when local-part is only separators', () => {
    expect(deriveDisplayNameFromEmail('...@acme.com')).toBeNull()
    expect(deriveDisplayNameFromEmail('___@acme.com')).toBeNull()
  })

  it('trims surrounding whitespace before processing', () => {
    expect(deriveDisplayNameFromEmail('  anna.nowak@om.pl  ')).toBe('Anna Nowak')
  })
})
