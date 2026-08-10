import { formatDate } from '../formatDate'

describe('formatDate', () => {
  it.each([
    ['en', '05/09/2026'],
    ['pl', '09.05.2026'],
    ['de', '09.05.2026'],
    ['es', '09/05/2026'],
  ])('formats an ISO date for the %s locale', (locale, expected) => {
    expect(formatDate('2026-05-09T10:30:00.000Z', locale)).toBe(expected)
  })

  it('pads single-digit day and month to two digits', () => {
    expect(formatDate('2026-01-03T00:00:00.000Z', 'pl')).toBe('03.01.2026')
  })

  it('returns "Invalid Date" for an unparseable input', () => {
    expect(formatDate('not-a-date', 'en')).toBe('Invalid Date')
  })
})
