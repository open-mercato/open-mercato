import { formatReportPeriodDate } from '../reportPeriod'

describe('formatReportPeriodDate', () => {
  it('keeps the YYYY-MM-DD string MikroORM hydrates a date column as', () => {
    expect(formatReportPeriodDate('2026-08-01')).toBe('2026-08-01')
    expect(formatReportPeriodDate('2026-08-31')).toBe('2026-08-31')
  })

  it('trims a timestamp string down to its date', () => {
    expect(formatReportPeriodDate('2026-08-31T00:00:00.000Z')).toBe('2026-08-31')
  })

  it('formats a Date instance', () => {
    expect(formatReportPeriodDate(new Date('2026-09-30'))).toBe('2026-09-30')
  })

  it('returns null for missing or unparseable values', () => {
    expect(formatReportPeriodDate(null)).toBeNull()
    expect(formatReportPeriodDate(undefined)).toBeNull()
    expect(formatReportPeriodDate('')).toBeNull()
    expect(formatReportPeriodDate('not a date')).toBeNull()
    expect(formatReportPeriodDate(new Date('invalid'))).toBeNull()
  })
})
