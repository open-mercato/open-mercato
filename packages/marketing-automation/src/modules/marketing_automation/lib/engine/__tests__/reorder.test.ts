import {
  cycleNumber,
  MAXIMUM_CYCLE_DAYS,
  medianGapDays,
  MINIMUM_CYCLE_DAYS,
  MINIMUM_PURCHASES_FOR_CYCLE,
  reorderCycleFor,
} from '../reorder'

const NOW = new Date('2026-09-29T00:00:00.000Z')
const MS_PER_DAY = 86_400_000
const daysAgo = (days: number) => new Date(NOW.getTime() - days * MS_PER_DAY)

describe('medianGapDays', () => {
  test('a steady habit reads as its interval', () => {
    // Bought every 30 days, four times.
    expect(medianGapDays([daysAgo(0), daysAgo(30), daysAgo(60), daysAgo(90)])).toBe(30)
  })

  /**
   * The reason it is a median.
   *
   * One bulk order before a holiday, or one gap spanning a house move, drags a mean far enough to make every
   * prediction wrong. Here the mean would be about 47 days and the truth is 30.
   */
  test('one freak gap does not move the answer', () => {
    const median = medianGapDays([daysAgo(0), daysAgo(30), daysAgo(60), daysAgo(150)])
    expect(median).toBe(30)
  })

  test('two purchases are a coincidence, not a cadence', () => {
    expect(medianGapDays([daysAgo(0), daysAgo(4)])).toBeNull()
    expect(MINIMUM_PURCHASES_FOR_CYCLE).toBe(3)
  })

  test('with two gaps the median is their average, because nothing prefers one', () => {
    expect(medianGapDays([daysAgo(0), daysAgo(20), daysAgo(60)])).toBe(30)
  })

  test('same-day purchases contribute no gap', () => {
    // A split delivery is one purchase decision, not two.
    expect(medianGapDays([daysAgo(0), daysAgo(0), daysAgo(0)])).toBeNull()
  })
})

describe('reorderCycleFor', () => {
  const steady = { sku: 'COFFEE-1KG', purchasedAt: [daysAgo(31), daysAgo(61), daysAgo(91)] }

  test('reports a customer who is due, and how far through the cycle they are', () => {
    const cycle = reorderCycleFor(steady, NOW)
    expect(cycle).toMatchObject({ sku: 'COFFEE-1KG', cycleDays: 30, purchases: 3, daysSinceLast: 31 })
    expect(cycle?.progress).toBeCloseTo(1.03, 2)
  })

  test('says nothing about somebody who bought yesterday', () => {
    expect(reorderCycleFor({ sku: 'COFFEE-1KG', purchasedAt: [daysAgo(1), daysAgo(31), daysAgo(61)] }, NOW)).toBeNull()
  })

  /**
   * A tolerance is what a shop selling something people hate running out of actually wants: remind them a
   * little early rather than after they have bought elsewhere.
   */
  test('a tolerance brings the reminder forward', () => {
    const almost = { sku: 'COFFEE-1KG', purchasedAt: [daysAgo(27), daysAgo(57), daysAgo(87)] }
    expect(reorderCycleFor(almost, NOW)).toBeNull()
    expect(reorderCycleFor(almost, NOW, 0.15)).not.toBeNull()
  })

  test('a negative tolerance waits until they are properly late', () => {
    const justDue = { sku: 'COFFEE-1KG', purchasedAt: [daysAgo(31), daysAgo(61), daysAgo(91)] }
    expect(reorderCycleFor(justDue, NOW, -0.5)).toBeNull()
  })

  test('refuses a cadence too short to be a repeat purchase', () => {
    const rapid = { sku: 'X', purchasedAt: [daysAgo(1), daysAgo(2), daysAgo(3)] }
    expect(reorderCycleFor(rapid, NOW)).toBeNull()
    expect(MINIMUM_CYCLE_DAYS).toBeGreaterThan(1)
  })

  test('refuses a cadence too long to be a habit', () => {
    const rare = { sku: 'MATTRESS', purchasedAt: [daysAgo(400), daysAgo(1200), daysAgo(2000)] }
    expect(reorderCycleFor(rare, NOW)).toBeNull()
    expect(MAXIMUM_CYCLE_DAYS).toBe(365)
  })

  test('refuses a history with no cadence at all', () => {
    expect(reorderCycleFor({ sku: 'X', purchasedAt: [daysAgo(10)] }, NOW)).toBeNull()
    expect(reorderCycleFor({ sku: 'X', purchasedAt: [] }, NOW)).toBeNull()
  })
})

describe('cycleNumber', () => {
  const cycle = (daysSinceLast: number, cycleDays = 30) => ({
    sku: 'X', cycleDays, purchases: 3, daysSinceLast, progress: daysSinceLast / cycleDays,
  })

  /**
   * The claim key's suffix, and the reason a reorder reminder is neither once-ever nor daily.
   *
   * Somebody 31 days into a 30-day habit is in cycle 2; thirty days later they are in cycle 3 and that is a new
   * claim. Without the number, a durable claim would silence the feature after one reminder, and without a claim
   * at all an overdue customer would be nagged every single day.
   */
  test('numbers the cycles, so each one is claimed once', () => {
    expect(cycleNumber(cycle(31))).toBe(2)
    expect(cycleNumber(cycle(61))).toBe(3)
    expect(cycleNumber(cycle(91))).toBe(4)
  })

  test('never returns zero, so the first reminder has a claim of its own', () => {
    expect(cycleNumber(cycle(0))).toBe(1)
    expect(cycleNumber(cycle(29))).toBe(1)
  })
})
