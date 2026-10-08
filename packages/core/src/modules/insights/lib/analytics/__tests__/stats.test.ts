import {
  buildHistogram,
  createSuppressionTally,
  effectiveKAnonymity,
  guardDurationStats,
  guardedMedian,
  guardedP90,
  isLowConfidence,
  lift,
  quantile,
  rate,
  sortAscending,
  summarizeDurations,
  suppressionReason,
  wilsonLowerBound,
} from '../stats'
import { DAY_MS } from './analyticsTestSupport'

function range(count: number): number[] {
  return Array.from({ length: count }, (_unused, index) => index + 1)
}

describe('X-Ray analytics statistics', () => {
  it('interpolates quantiles like percentile_cont', () => {
    expect(quantile([], 0.5)).toBeNull()
    expect(quantile([7], 0.9)).toBe(7)
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile(sortAscending(range(10)), 0.9)).toBeCloseTo(9.1, 10)
    expect(quantile([1, 2, 3], 1.5)).toBe(3)
  })

  it('withholds the median below n = 5 and the p90 below n = 20, always returning n', () => {
    expect(summarizeDurations(range(4))).toEqual({ n: 4, medianMs: null, p90Ms: null, lowConfidence: true })
    expect(summarizeDurations(range(5))).toEqual({ n: 5, medianMs: 3, p90Ms: null, lowConfidence: true })
    expect(guardedP90(range(19))).toBeNull()
    expect(guardedP90(range(20))).toBe(18)
    expect(guardedMedian(range(20))).toBe(11)
    expect(summarizeDurations([]).n).toBe(0)
  })

  it('flags n < 30 as low confidence', () => {
    expect(isLowConfidence(29)).toBe(true)
    expect(isLowConfidence(30)).toBe(false)
    expect(guardDurationStats(30, 1000.4, 2000.6)).toEqual({ n: 30, medianMs: 1000, p90Ms: 2001, lowConfidence: false })
  })

  it('computes the Wilson lower bound, rates and lift', () => {
    expect(wilsonLowerBound(8, 10)).toBeCloseTo(0.4902, 4)
    expect(wilsonLowerBound(0, 0)).toBeNull()
    expect(wilsonLowerBound(0, 5)).toBe(0)
    expect(wilsonLowerBound(20, 20)).toBeGreaterThan(0.8)
    expect(wilsonLowerBound(20, 20)).toBeLessThan(1)
    expect(rate(3, 0)).toBeNull()
    expect(rate(3, 4)).toBe(0.75)
    expect(lift(0.6, 0.2)).toBeCloseTo(3, 10)
    expect(lift(0.6, 0)).toBeNull()
  })

  it('never lets k drop below the minimum and applies the actor rule only to cells with actors', () => {
    expect(effectiveKAnonymity(undefined)).toBe(10)
    expect(effectiveKAnonymity(3)).toBe(5)
    expect(effectiveKAnonymity(12)).toBe(12)
    expect(suppressionReason({ cases: 9, actors: 5 }, 10)).toBe('min_cases')
    expect(suppressionReason({ cases: 10, actors: 2 }, 10)).toBe('min_actors')
    expect(suppressionReason({ cases: 10, actors: 0 }, 10)).toBeNull()
    expect(suppressionReason({ cases: 10, actors: 3 }, 10)).toBeNull()
    expect(suppressionReason({ cases: 10, actors: 1 }, 10, { actorRule: false })).toBeNull()
    const tally = createSuppressionTally()
    tally.record('min_cases')
    tally.record('min_actors')
    tally.record('min_cases')
    expect(tally.summary()).toEqual({ cells: 3, minCases: 2, minActors: 1 })
  })

  it('buckets ages into the histogram', () => {
    const histogram = buildHistogram([0, DAY_MS - 1, DAY_MS, 8 * DAY_MS, 45 * DAY_MS, 90 * DAY_MS, 400 * DAY_MS])
    expect(histogram).toEqual([
      { bucket: 'lt_1d', count: 2 },
      { bucket: '1d_7d', count: 1 },
      { bucket: '7d_30d', count: 1 },
      { bucket: '30d_90d', count: 1 },
      { bucket: 'gte_90d', count: 2 },
    ])
  })
})
