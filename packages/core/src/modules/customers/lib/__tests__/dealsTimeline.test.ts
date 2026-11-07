import {
  addBuckets,
  alignToBucketStart,
  bucketIndexFor,
  buildTimelineColumns,
  defaultColumnCount,
  defaultTimelineFrom,
  endOfMonth,
  endOfQuarter,
  isValidDateKey,
  isoWeekNumber,
  noStageLaneKey,
  parseNoStageLaneKey,
  shiftCloseDate,
  toUtcDateKey,
} from '../dealsTimeline'

describe('dealsTimeline', () => {
  describe('toUtcDateKey', () => {
    it('keeps date keys and reads the UTC calendar date of timestamps', () => {
      expect(toUtcDateKey('2026-11-02')).toBe('2026-11-02')
      expect(toUtcDateKey('2026-11-02T23:30:00-05:00')).toBe('2026-11-03')
      expect(toUtcDateKey(new Date('2026-11-02T00:00:00.000Z'))).toBe('2026-11-02')
      expect(toUtcDateKey(new Date('2026-11-02T22:15:00.000Z'))).toBe('2026-11-02')
    })

    it('returns null for empty or invalid input', () => {
      expect(toUtcDateKey(null)).toBeNull()
      expect(toUtcDateKey('')).toBeNull()
      expect(toUtcDateKey('not a date')).toBeNull()
      expect(isValidDateKey('2026-13-01')).toBe(false)
      expect(isValidDateKey('2026-02-30')).toBe(false)
      expect(isValidDateKey('2028-02-29')).toBe(true)
    })
  })

  describe('alignToBucketStart', () => {
    it('aligns weeks to ISO Monday across year boundaries', () => {
      expect(alignToBucketStart('2026-11-05', 'week')).toBe('2026-11-02')
      expect(alignToBucketStart('2026-11-02', 'week')).toBe('2026-11-02')
      expect(alignToBucketStart('2026-11-08', 'week')).toBe('2026-11-02')
      expect(alignToBucketStart('2027-01-01', 'week')).toBe('2026-12-28')
      expect(alignToBucketStart('2021-01-03', 'week')).toBe('2020-12-28')
    })

    it('aligns months and quarters', () => {
      expect(alignToBucketStart('2026-11-19', 'month')).toBe('2026-11-01')
      expect(alignToBucketStart('2026-11-19', 'quarter')).toBe('2026-10-01')
      expect(alignToBucketStart('2026-03-31', 'quarter')).toBe('2026-01-01')
      expect(alignToBucketStart('2026-12-31T23:59:59Z', 'quarter')).toBe('2026-10-01')
    })
  })

  describe('isoWeekNumber', () => {
    it('handles week 53 and week 1', () => {
      expect(isoWeekNumber('2020-12-31')).toBe(53)
      expect(isoWeekNumber('2021-01-03')).toBe(53)
      expect(isoWeekNumber('2021-01-04')).toBe(1)
      expect(isoWeekNumber('2026-12-31')).toBe(53)
      expect(isoWeekNumber('2027-01-04')).toBe(1)
      expect(isoWeekNumber('2026-11-05')).toBe(45)
    })
  })

  describe('defaults', () => {
    it('anchors on last week, the current month and the current quarter', () => {
      expect(defaultTimelineFrom('week', '2026-11-05')).toBe('2026-10-26')
      expect(defaultTimelineFrom('month', '2026-11-05')).toBe('2026-11-01')
      expect(defaultTimelineFrom('quarter', '2026-11-05')).toBe('2026-10-01')
      expect(defaultColumnCount('week')).toBe(5)
      expect(defaultColumnCount('month')).toBe(4)
      expect(defaultColumnCount('quarter')).toBe(4)
    })
  })

  describe('buildTimelineColumns', () => {
    it('builds half-open week columns and flags the current one', () => {
      const columns = buildTimelineColumns('week', '2026-10-28', 5, '2026-11-05')
      expect(columns.map((column) => [column.from, column.to])).toEqual([
        ['2026-10-26', '2026-11-02'],
        ['2026-11-02', '2026-11-09'],
        ['2026-11-09', '2026-11-16'],
        ['2026-11-16', '2026-11-23'],
        ['2026-11-23', '2026-11-30'],
      ])
      expect(columns.map((column) => column.isCurrent)).toEqual([false, true, false, false, false])
    })

    it('builds quarter columns across a year boundary and clamps the count', () => {
      const columns = buildTimelineColumns('quarter', '2026-11-05', 20, '2026-11-05')
      expect(columns).toHaveLength(8)
      expect(columns[0]).toMatchObject({ from: '2026-10-01', to: '2027-01-01', isCurrent: true })
      expect(columns[1]).toMatchObject({ from: '2027-01-01', to: '2027-04-01' })
      expect(buildTimelineColumns('month', '2026-11-05', 0, '2026-11-05')).toHaveLength(1)
    })
  })

  describe('bucketIndexFor', () => {
    const columns = buildTimelineColumns('week', '2026-10-26', 3, '2026-11-05')

    it('places boundary dates in exactly one column', () => {
      expect(bucketIndexFor('2026-10-26', columns)).toBe(0)
      expect(bucketIndexFor('2026-11-01', columns)).toBe(0)
      expect(bucketIndexFor('2026-11-02', columns)).toBe(1)
      expect(bucketIndexFor('2026-11-15T23:59:59.000Z', columns)).toBe(2)
      expect(bucketIndexFor('2026-11-16', columns)).toBe(-1)
      expect(bucketIndexFor('2026-10-25', columns)).toBe(-1)
      expect(bucketIndexFor(null, columns)).toBe(-1)
    })
  })

  describe('shiftCloseDate', () => {
    it('shifts weeks keeping the weekday, including negative shifts', () => {
      expect(shiftCloseDate('2026-11-04', 'week', 1)).toBe('2026-11-11')
      expect(shiftCloseDate('2026-11-04', 'week', -2)).toBe('2026-10-21')
      expect(shiftCloseDate('2026-12-30', 'week', 1)).toBe('2027-01-06')
    })

    it('clamps month and quarter shifts to the month end', () => {
      expect(shiftCloseDate('2026-01-31', 'month', 1)).toBe('2026-02-28')
      expect(shiftCloseDate('2028-01-31', 'month', 1)).toBe('2028-02-29')
      expect(shiftCloseDate('2026-11-30', 'quarter', 1)).toBe('2027-02-28')
      expect(shiftCloseDate('2026-03-31', 'month', -1)).toBe('2026-02-28')
      expect(shiftCloseDate('2026-01-15', 'quarter', -1)).toBe('2025-10-15')
    })

    it('normalises non-midnight timestamps to the UTC date', () => {
      expect(shiftCloseDate('2026-11-04T18:45:00.000Z', 'week', 1)).toBe('2026-11-11')
      expect(shiftCloseDate(new Date('2026-11-04T23:59:00.000Z'), 'month', 1)).toBe('2026-12-04')
    })
  })

  describe('helpers', () => {
    it('moves windows by whole buckets', () => {
      expect(addBuckets('2026-11-05', 'week', 1)).toBe('2026-11-09')
      expect(addBuckets('2026-11-05', 'month', -1)).toBe('2026-10-01')
      expect(addBuckets('2026-11-05', 'quarter', 1)).toBe('2027-01-01')
    })

    it('computes month and quarter ends', () => {
      expect(endOfMonth('2026-02-10')).toBe('2026-02-28')
      expect(endOfQuarter('2026-11-05')).toBe('2026-12-31')
      expect(endOfQuarter('2026-01-05')).toBe('2026-03-31')
    })

    it('round-trips no-stage lane keys', () => {
      expect(noStageLaneKey('p-1')).toBe('__nostage:p-1')
      expect(parseNoStageLaneKey('__nostage:p-1')).toEqual({ pipelineId: 'p-1' })
      expect(parseNoStageLaneKey('__nostage:')).toEqual({ pipelineId: null })
      expect(parseNoStageLaneKey('stage-1')).toBeNull()
    })
  })
})
