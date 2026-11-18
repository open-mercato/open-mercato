import {
  cancelEffectiveOn,
  daysUntil,
  extensionAnchorDay,
  extensionStartsOn,
  leaseAnniversary,
  leaseEndsOn,
  monthsRemainingAfter,
  nextAnniversaryAfter,
  rangesOverlap,
  reservedInterval,
  respondByDate,
} from '../lib/leaseTerm'

describe('leaseTerm', () => {
  it('ends a 12-month lease on the day before the anniversary', () => {
    expect(leaseEndsOn('2026-03-15', 12)).toBe('2027-03-14')
    expect(leaseEndsOn('2026-01-01', 24)).toBe('2027-12-31')
  })

  it('applies the month-end rule to a 31 January start', () => {
    expect(leaseAnniversary('2026-01-31', 1)).toBe('2026-02-28')
    expect(leaseAnniversary('2026-01-31', 2)).toBe('2026-03-31')
    expect(leaseEndsOn('2026-01-31', 1)).toBe('2026-02-27')
    expect(leaseEndsOn('2026-01-31', 12)).toBe('2027-01-30')
    expect(leaseEndsOn('2026-01-31', 24)).toBe('2028-01-30')
    expect(leaseAnniversary('2027-01-31', 1)).toBe('2027-02-28')
    expect(leaseAnniversary('2028-01-31', 1)).toBe('2028-02-29')
  })

  it('rejects terms that are not whole positive months', () => {
    expect(() => leaseEndsOn('2026-01-01', 0)).toThrow('[internal]')
    expect(() => leaseEndsOn('2026-01-01', 1.5)).toThrow('[internal]')
  })

  it('starts an extension the day after the term and keeps the original billing day', () => {
    const currentEnd = leaseEndsOn('2026-01-31', 1)
    const start = extensionStartsOn(currentEnd)
    expect(start).toBe('2026-02-28')
    const anchor = extensionAnchorDay('2026-01-31', start)
    expect(anchor).toBe(31)
    expect(leaseAnniversary(start, 1, anchor)).toBe('2026-03-31')
    expect(leaseEndsOn(start, 2, anchor)).toBe('2026-04-29')
    expect(extensionAnchorDay('2026-03-15', '2027-03-15')).toBeNull()
  })

  it('counts months remaining after a date and finds the next anniversary', () => {
    expect(monthsRemainingAfter('2026-01-10', 12, '2026-03-20')).toBe(9)
    expect(nextAnniversaryAfter('2026-01-10', 12, '2026-03-20')).toBe('2026-04-10')
    expect(nextAnniversaryAfter('2026-01-10', 2, '2026-03-20')).toBeNull()
  })

  it('cancels from the day after the new end, or from the order start when it has not started', () => {
    expect(cancelEffectiveOn('2026-05-14', '2026-01-01')).toBe('2026-05-15')
    expect(cancelEffectiveOn('2026-05-14', '2026-07-01')).toBe('2026-07-01')
  })

  it('detects overlapping terms inclusively', () => {
    expect(rangesOverlap({ startsOn: '2026-01-01', endsOn: '2026-12-31' }, { startsOn: '2026-12-31', endsOn: '2027-01-30' })).toBe(true)
    expect(rangesOverlap({ startsOn: '2026-01-01', endsOn: '2026-12-31' }, { startsOn: '2027-01-01', endsOn: '2027-01-30' })).toBe(false)
  })

  it('derives respond-by dates and days left from the local calendar', () => {
    expect(respondByDate(14, '2026-10-28')).toBe('2026-11-11')
    expect(daysUntil('2026-11-11', '2026-10-28')).toBe(14)
  })

  describe('reservedInterval', () => {
    const term = { startsOn: '2026-01-01', endsOn: '2026-06-30' }
    const pending = (kind: 'end' | 'delete' | 'correction' | 'reschedule', previous: { startsOn: string; endsOn: string }) => ({
      ...term,
      pendingChange: { kind, previous },
    })

    it('is the current term without a pending change', () => {
      expect(reservedInterval(term)).toEqual(term)
      expect(reservedInterval({ ...term, pendingChange: null })).toEqual(term)
    })

    it('keeps the months a pending end releases', () => {
      expect(reservedInterval(pending('end', { startsOn: '2026-01-01', endsOn: '2026-12-31' }))).toEqual({
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
      })
    })

    it('spans the old and new start of a pending reschedule', () => {
      expect(reservedInterval({ startsOn: '2026-03-01', endsOn: '2026-08-31', pendingChange: { kind: 'reschedule', previous: term } })).toEqual({
        startsOn: '2026-01-01',
        endsOn: '2026-08-31',
      })
    })

    it('keeps no union for a correction or a delete', () => {
      const wider = { startsOn: '2025-01-01', endsOn: '2027-12-31' }
      expect(reservedInterval(pending('correction', wider))).toEqual(term)
      expect(reservedInterval(pending('delete', wider))).toEqual(term)
    })
  })
})
