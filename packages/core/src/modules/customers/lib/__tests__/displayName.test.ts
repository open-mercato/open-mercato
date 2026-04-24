/** @jest-environment node */
import { deriveDisplayNameFromEmail } from '../displayName'

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
