import { formatDate } from '..'

describe('formatDate', () => {
  it.each([
    ['en', '5/9/2026'],
    ['pl', '9.05.2026'],
    ['de', '9.5.2026'],
    ['es', '9/5/2026'],
    ['ko', '2026. 5. 9.'],
  ])('formats an ISO date for the %s locale', (locale, expected) => {
    expect(formatDate('2026-05-09T10:30:00.000Z', locale)).toBe(expected)
  })

  it('uses UTC so a timestamp near midnight does not shift with the server time zone', () => {
    expect(formatDate('2026-01-03T00:30:00.000+14:00', 'en')).toBe('1/2/2026')
  })

  it('returns "Invalid Date" for an unparseable input', () => {
    expect(formatDate('not-a-date', 'en')).toBe('Invalid Date')
  })
})
