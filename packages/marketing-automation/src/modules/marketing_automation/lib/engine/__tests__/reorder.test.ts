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
   * The claim key's suffix, and the property that matters is STABILITY — not the particular number.
   *
   * The previous version of this test asserted the numbers 2, 3 and 4 for days 31, 61 and 91, which is an
   * implementation detail, and it passed while the real defect went unnoticed: the numbering disagreed with the
   * firing rule inside the tolerance band, so an early reminder and an on-time one claimed different cycles and
   * the customer was emailed twice three days apart. These tests assert what the claim key has to do instead.
   */
  test('is stable across one cycle, so the reminder is claimed once', () => {
    const first = cycleNumber(cycle(30))
    expect(cycleNumber(cycle(35))).toBe(first)
    expect(cycleNumber(cycle(59))).toBe(first)
  })

  test('changes at the next cycle, so the reminder comes round again', () => {
    expect(cycleNumber(cycle(60))).not.toBe(cycleNumber(cycle(30)))
    expect(cycleNumber(cycle(90))).not.toBe(cycleNumber(cycle(60)))
  })

  /**
   * The regression, stated as the arithmetic that produced it.
   *
   * With a ten per cent tolerance on a thirty-day habit the sweep fires on day 27; three days later it fires
   * again as "on time". Both must carry the SAME claim, or the durable claim protects nothing.
   */
  test('an early reminder and an on-time one share a claim', () => {
    const tolerance = 0.1
    expect(cycleNumber(cycle(27), tolerance)).toBe(cycleNumber(cycle(30), tolerance))
    expect(cycleNumber(cycle(27), tolerance)).toBe(cycleNumber(cycle(35), tolerance))
  })

  test('and the next cycle still gets its own claim, tolerance or not', () => {
    const tolerance = 0.1
    expect(cycleNumber(cycle(57), tolerance)).not.toBe(cycleNumber(cycle(30), tolerance))
  })

  test('never returns zero, so the first reminder has a claim of its own', () => {
    expect(cycleNumber(cycle(0))).toBeGreaterThanOrEqual(1)
    expect(cycleNumber(cycle(29))).toBeGreaterThanOrEqual(1)
    expect(cycleNumber(cycle(27), 0.1)).toBeGreaterThanOrEqual(1)
  })

  test('a shorter cadence turns over faster, as the cycles are its own', () => {
    // A weekly habit: day 7 and day 13 are one cycle, day 14 is the next.
    expect(cycleNumber(cycle(13, 7))).toBe(cycleNumber(cycle(7, 7)))
    expect(cycleNumber(cycle(14, 7))).not.toBe(cycleNumber(cycle(7, 7)))
  })
})
