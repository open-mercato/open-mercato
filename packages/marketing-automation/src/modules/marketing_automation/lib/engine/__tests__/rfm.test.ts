import {
  ascendingBucket,
  computeRfm,
  DEFAULT_VALUE_HORIZON_YEARS,
  descendingBucket,
  EMPTY_VALUE_BOUNDARIES,
  grossPercentile,
  MINIMUM_BUYERS_FOR_RFM,
  projectCustomerValue,
  RFM_BUCKETS,
} from '../rfm'
import type { ValueBoundaries } from '../rfm'

const boundaries: ValueBoundaries = {
  // Four cut points per dimension: 5 buckets.
  recencyDays: [14, 45, 120, 365],
  frequency: [1, 3, 6, 12],
  monetary: [100, 400, 1200, 5000],
  grossPercentiles: Array.from({ length: 19 }, (_, index) => (index + 1) * 250),
  buyerCount: 500,
  computedAt: '2026-09-29T03:00:00.000Z',
}

describe('bucketing', () => {
  test('five buckets, from four cut points', () => {
    expect(RFM_BUCKETS).toBe(5)
    expect(ascendingBucket(0, boundaries.frequency)).toBe(1)
    expect(ascendingBucket(2, boundaries.frequency)).toBe(2)
    expect(ascendingBucket(100, boundaries.frequency)).toBe(5)
  })

  test('a value exactly on a cut point falls in the lower bucket, always', () => {
    // Arbitrary but consistent, which is the property that matters: two customers with the same numbers
    // must always score the same.
    expect(ascendingBucket(3, boundaries.frequency)).toBe(2)
    expect(ascendingBucket(3.01, boundaries.frequency)).toBe(3)
  })

  /**
   * Recency is the one dimension that inverts, and getting it backwards is not a cosmetic bug: it would mail
   * the most engaged fifth of the customer base a win-back campaign.
   */
  test('recency inverts: fewer days is a higher score', () => {
    expect(descendingBucket(1, boundaries.recencyDays)).toBe(5)
    expect(descendingBucket(1000, boundaries.recencyDays)).toBe(1)
    expect(descendingBucket(30, boundaries.recencyDays)).toBe(4)
  })

  test('no boundaries means no opinion, rather than a middling one', () => {
    expect(ascendingBucket(5, [])).toBeNull()
    expect(descendingBucket(5, [1, 2, 3])).toBeNull()
  })
})

describe('computeRfm', () => {
  test('scores a customer against the shop', () => {
    expect(computeRfm({ count: 8, totalGross: 900, daysSinceLast: 10 }, boundaries)).toEqual({
      recency: 5, frequency: 4, monetary: 3, cell: '543', total: 12,
    })
  })

  /**
   * The rule the rest of this module already lives by, applied here.
   *
   * A never-buyer scored `recency: 1` would be indistinguishable from a customer who lapsed years ago, and
   * every win-back audience would collect them.
   */
  test('a customer who never ordered has no scores at all', () => {
    expect(computeRfm({ count: 0, totalGross: 0 }, boundaries)).toBeNull()
    // And the same when a count arrived without a date, which should not happen but must not score if it does.
    expect(computeRfm({ count: 3, totalGross: 300 }, boundaries)).toBeNull()
  })

  test('a shop with too few buyers to rank against produces no scores', () => {
    const thin = { ...boundaries, buyerCount: MINIMUM_BUYERS_FOR_RFM - 1 }
    expect(computeRfm({ count: 8, totalGross: 900, daysSinceLast: 10 }, thin)).toBeNull()
  })

  test('a fresh installation with no boundaries produces no scores', () => {
    expect(computeRfm({ count: 8, totalGross: 900, daysSinceLast: 10 }, EMPTY_VALUE_BOUNDARIES)).toBeNull()
  })
})

describe('grossPercentile', () => {
  test('reports a position to the nearest 5th percentile', () => {
    expect(grossPercentile(10, boundaries)).toBe(0)
    expect(grossPercentile(2600, boundaries)).toBe(50)
    // The FLOOR of the bucket: the top twentieth reports 95, because there is no cut point above them and
    // saying 100 would claim a single best customer where the data describes a top 5%.
    expect(grossPercentile(999_999, boundaries)).toBe(95)
  })

  test('says nothing when there is nothing to compare against', () => {
    expect(grossPercentile(500, EMPTY_VALUE_BOUNDARIES)).toBeNull()
    expect(grossPercentile(500, { ...boundaries, buyerCount: 3 })).toBeNull()
  })
})

describe('projectCustomerValue', () => {
  const now = new Date('2026-09-29T00:00:00.000Z')

  test('the average order value is available from the first order', () => {
    const projection = projectCustomerValue({ count: 1, totalGross: 250 }, now)
    expect(projection).toEqual({ averageOrderGross: 250 })
  })

  /**
   * One order is not a rate.
   *
   * Projecting a cadence from a single purchase would rank a one-off big spender above a customer who buys
   * steadily every month, which inverts the only thing the number is for.
   */
  test('a single order yields no rate and no projection', () => {
    const projection = projectCustomerValue({ count: 1, totalGross: 250, firstPlacedAt: '2026-09-01T00:00:00.000Z' }, now)
    expect(projection?.ordersPerYear).toBeUndefined()
    expect(projection?.projectedHorizonGross).toBeUndefined()
  })

  test('projects from the customer own cadence over the horizon', () => {
    // Four orders over roughly a year, 100 each: about four a year, about 800 over two years.
    const projection = projectCustomerValue(
      { count: 4, totalGross: 400, daysSinceLast: 5, firstPlacedAt: '2025-09-29T00:00:00.000Z' },
      now,
    )
    expect(projection?.averageOrderGross).toBe(100)
    expect(projection?.ordersPerYear).toBeCloseTo(4, 1)
    expect(projection?.projectedAnnualGross).toBeCloseTo(400, 0)
    expect(projection?.projectedHorizonGross).toBeCloseTo(400 * DEFAULT_VALUE_HORIZON_YEARS, 0)
  })

  /**
   * The window is first order → NOW, never first → last.
   *
   * Two orders in one week followed by two years of silence is not a hundred-orders-a-year customer, and
   * measuring to the last order would say exactly that, forever.
   */
  test('silence since the last order lowers the rate', () => {
    const burst = projectCustomerValue(
      { count: 2, totalGross: 200, daysSinceLast: 700, firstPlacedAt: '2024-09-22T00:00:00.000Z' },
      now,
    )
    expect(burst?.ordersPerYear).toBeLessThan(1.5)
  })

  test('a customer with no orders is not projected at all', () => {
    expect(projectCustomerValue({ count: 0, totalGross: 0 }, now)).toBeNull()
  })

  test('an unusable first-order date degrades to the average alone', () => {
    const projection = projectCustomerValue({ count: 5, totalGross: 500, firstPlacedAt: 'not a date' }, now)
    expect(projection).toEqual({ averageOrderGross: 100 })
  })
})
