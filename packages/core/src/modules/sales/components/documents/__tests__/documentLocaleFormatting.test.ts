import { formatPercent } from '../AdjustmentsSection'
import { formatDisplayDate } from '../ReturnsSection'
import { formatDisplayDate as formatShipmentDisplayDate } from '../ShipmentsSection'

// The sales document detail page renders these three tabs next to an items table
// that already formats in the application locale. Formatting them from the runtime
// default puts two conventions on one screen, which is what UI QA caught on this PR
// (PR #5182). Each assertion pins a non-English locale so a revert to
// `Intl.*(undefined, …)` fails loudly instead of merely looking plausible.
const normalize = (value: string) => value.replace(/ | /g, ' ')

// A date-time literal without an offset is parsed as *local* time, so it lands on the same
// calendar day in every timezone and the day token can be asserted exactly. An instant does
// not: `2026-06-09T10:00:00.000Z` renders as June 10 under `Pacific/Kiritimati` (UTC+14) and
// June 8 under `Etc/GMT+12`, which made this suite fail for contributors and CI runners at the
// extremes — the very machine-dependence this PR exists to remove. Midday keeps it clear of
// any DST transition.
const LOCAL_MIDDAY = '2026-06-09T12:00:00'

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
    expect(formatDisplayDate(LOCAL_MIDDAY, 'pl-PL')).toBe('9 cze 2026')
    expect(formatDisplayDate(LOCAL_MIDDAY, 'en-US')).toBe('Jun 9, 2026')
  })

  it('returns null for an absent or unparseable value', () => {
    expect(formatDisplayDate(null, 'pl-PL')).toBeNull()
    expect(formatDisplayDate(undefined, 'pl-PL')).toBeNull()
    expect(formatDisplayDate('not a date', 'pl-PL')).toBeNull()
  })
})

// The shipments tab renders directly beside the returns tab above, and its date helper is a
// byte-for-byte copy of the returns one. Leaving it on the runtime default is what put Polish
// returns dates next to American shipment dates on one page, so it is asserted in the same shape.
describe('sales shipments — date formatting', () => {
  it('formats in the requested locale rather than the runtime default', () => {
    expect(formatShipmentDisplayDate(LOCAL_MIDDAY, 'pl-PL')).toBe('9 cze 2026')
    expect(formatShipmentDisplayDate(LOCAL_MIDDAY, 'en-US')).toBe('Jun 9, 2026')
  })

  it('returns null for an absent or unparseable value', () => {
    expect(formatShipmentDisplayDate(null, 'pl-PL')).toBeNull()
    expect(formatShipmentDisplayDate(undefined, 'pl-PL')).toBeNull()
    expect(formatShipmentDisplayDate('not a date', 'pl-PL')).toBeNull()
  })

  it('agrees with the returns tab it renders beside', () => {
    expect(formatShipmentDisplayDate(LOCAL_MIDDAY, 'pl-PL')).toBe(formatDisplayDate(LOCAL_MIDDAY, 'pl-PL'))
  })
})
