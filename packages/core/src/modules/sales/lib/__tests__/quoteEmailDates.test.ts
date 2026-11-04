import { formatQuoteValidUntil } from '../quoteEmailDates'

describe('formatQuoteValidUntil', () => {
  // 23:30 UTC on Dec 31 is already Jan 1 in Warsaw.
  const validUntil = new Date('2026-12-31T23:30:00.000Z')

  it('names the day in the tenant time zone', () => {
    expect(formatQuoteValidUntil(validUntil, 'en', { locale: null, timeZone: 'Europe/Warsaw' })).toBe('January 1, 2027')
    expect(formatQuoteValidUntil(validUntil, 'en', { locale: null, timeZone: 'UTC' })).toBe('December 31, 2026')
  })

  it('prefers the tenant formatting locale over the request locale', () => {
    expect(formatQuoteValidUntil(validUntil, 'en', { locale: 'en-GB', timeZone: 'UTC' })).toBe('31 December 2026')
  })

  it('uses the request locale when no formatting locale is set', () => {
    expect(formatQuoteValidUntil(validUntil, 'de', { locale: null, timeZone: 'UTC' })).toBe('31. Dezember 2026')
  })
})
