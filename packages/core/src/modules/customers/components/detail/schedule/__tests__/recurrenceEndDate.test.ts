import { isRecurrenceEndBeforeStart } from '../recurrenceEndDate'

describe('isRecurrenceEndBeforeStart', () => {
  it.each([
    { endType: 'date' as const, endDate: '2026-10-30', startDate: '2026-11-13', expected: true },
    { endType: 'date' as const, endDate: '2026-11-13', startDate: '2026-11-13', expected: false },
    { endType: 'date' as const, endDate: '2026-12-01', startDate: '2026-11-13', expected: false },
    { endType: 'date' as const, endDate: '', startDate: '2026-11-13', expected: false },
    { endType: 'date' as const, endDate: '2026-10-30', startDate: '', expected: false },
    { endType: 'count' as const, endDate: '2026-10-30', startDate: '2026-11-13', expected: false },
    { endType: 'never' as const, endDate: '2026-10-30', startDate: '2026-11-13', expected: false },
  ])('$endType end $endDate, start $startDate -> $expected', ({ endType, endDate, startDate, expected }) => {
    expect(isRecurrenceEndBeforeStart(endType, endDate, startDate)).toBe(expected)
  })
})
