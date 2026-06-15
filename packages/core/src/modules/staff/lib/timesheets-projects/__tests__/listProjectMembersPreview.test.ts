import { computeInitials } from '../initials'

describe('computeInitials', () => {
  it('returns two-letter initials from first and last name', () => {
    expect(computeInitials('Miguel Silva')).toBe('MS')
  })

  it('uses first two letters when only one word', () => {
    expect(computeInitials('Madonna')).toBe('MA')
  })

  it('uses first and last initial for 3+ word names', () => {
    expect(computeInitials('Ana Maria Costa')).toBe('AC')
  })

  it('returns ? for empty string', () => {
    expect(computeInitials('')).toBe('?')
  })

  it('returns ? for whitespace-only string', () => {
    expect(computeInitials('   ')).toBe('?')
  })

  it('uppercases lowercase input', () => {
    expect(computeInitials('jane doe')).toBe('JD')
  })

  it('handles multiple spaces between words', () => {
    expect(computeInitials('Jane   Doe')).toBe('JD')
  })
})
