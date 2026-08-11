import { formatPercent } from '../AdjustmentsSection'
import { formatDisplayDate } from '../ReturnsSection'

// The sales document detail page renders these three tabs next to an items table
// that already formats in the application locale. Formatting them from the runtime
// default puts two conventions on one screen, which is what UI QA caught on this PR
// (PR #5182). Each assertion pins a non-English locale so a revert to
// `Intl.*(undefined, …)` fails loudly instead of merely looking plausible.
const normalize = (value: string) => value.replace(/ | /g, ' ')

describe('sales document adjustments — percentage formatting', () => {
  it('formats in the requested locale rather than the runtime default', () => {
    expect(normalize(formatPercent(12.5, 'pl-PL'))).toBe('12,5%')
    expect(formatPercent(12.5, 'en-US')).toBe('12.5%')
  })

  it('keeps the em-dash placeholder for a missing rate', () => {
    expect(formatPercent(null, 'pl-PL')).toBe('—')
    expect(formatPercent(undefined, 'pl-PL')).toBe('—')
  })

  it('rounds to at most two fraction digits', () => {
    expect(formatPercent(12.3456, 'en-US')).toBe('12.35%')
  })
})

describe('sales returns — date formatting', () => {
  it('formats in the requested locale rather than the runtime default', () => {
    expect(formatDisplayDate('2026-06-09T10:00:00.000Z', 'pl-PL')).toBe('9 cze 2026')
    expect(formatDisplayDate('2026-06-09T10:00:00.000Z', 'en-US')).toBe('Jun 9, 2026')
  })

  it('returns null for an absent or unparseable value', () => {
    expect(formatDisplayDate(null, 'pl-PL')).toBeNull()
    expect(formatDisplayDate(undefined, 'pl-PL')).toBeNull()
    expect(formatDisplayDate('not a date', 'pl-PL')).toBeNull()
  })
})
