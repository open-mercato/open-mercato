/**
 * When a customer is due to buy something again, worked out from their own history.
 *
 * The one feature in the backlog with no substitute for a consumables business: coffee, filters, food, cosmetics
 * — the customer WILL buy again, the only question is whether they buy from this shop or from whoever reminded
 * them first.
 *
 * Pure arithmetic over purchase dates, so the rules below can be argued with and tested. The query that produces
 * those dates lives in `lib/sweep-sources.ts`.
 */

/**
 * Below this many purchases of the same product there is no interval, only a coincidence.
 *
 * Two purchases give one gap, and one gap is not a cadence — somebody who bought coffee twice in the same week
 * because they were stocking up would be "due" every four days forever. Three purchases give two gaps, which can
 * at least disagree with each other.
 */
export const MINIMUM_PURCHASES_FOR_CYCLE = 3

/** A cadence longer than this is not a habit, it is two unrelated purchases. */
export const MAXIMUM_CYCLE_DAYS = 365

/** And shorter than this is a split delivery or a mistake, not a repeat purchase. */
export const MINIMUM_CYCLE_DAYS = 3

export type PurchaseHistory = {
  sku: string
  /** Purchase dates, newest first, of the same product by the same customer. */
  purchasedAt: Date[]
}

export type ReorderCycle = {
  sku: string
  /** The typical gap between purchases, in whole days. */
  cycleDays: number
  /** How many purchases the cycle was derived from. */
  purchases: number
  /** Days since the most recent purchase. */
  daysSinceLast: number
  /**
   * How far through the cycle they are, where 1 means "due now".
   *
   * Reported rather than just compared, because an author writing copy wants the difference between "you are
   * probably running low" and "you ran out three weeks ago".
   */
  progress: number
}

const MS_PER_DAY = 86_400_000

/**
 * The MEDIAN gap, not the mean.
 *
 * One bulk order before a holiday, or one gap spanning a house move, drags a mean far enough to make every
 * prediction wrong; the median ignores both. With two gaps the median is their average, which is the honest
 * answer when there is nothing to prefer between them.
 */
export function medianGapDays(purchasedAt: Date[]): number | null {
  if (purchasedAt.length < MINIMUM_PURCHASES_FOR_CYCLE) return null

  const sorted = [...purchasedAt].sort((left, right) => right.getTime() - left.getTime())
  const gaps: number[] = []
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const gap = (sorted[index].getTime() - sorted[index + 1].getTime()) / MS_PER_DAY
    if (Number.isFinite(gap) && gap > 0) gaps.push(gap)
  }
  if (gaps.length === 0) return null

  gaps.sort((left, right) => left - right)
  const middle = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 === 1 ? gaps[middle] : (gaps[middle - 1] + gaps[middle]) / 2
  return Math.round(median)
}

/**
 * Whether this customer is due to reorder this product, and how overdue they are.
 *
 * `tolerance` shifts the moment: 0 means "the instant the cycle elapses", 0.1 means "a tenth of a cycle early",
 * which is what a shop selling something people hate running out of actually wants. Negative is allowed and
 * means late, for a shop that would rather remind people who have already lapsed.
 */
export function reorderCycleFor(
  history: PurchaseHistory,
  now: Date,
  tolerance = 0,
): ReorderCycle | null {
  const cycleDays = medianGapDays(history.purchasedAt)
  if (cycleDays === null) return null
  if (cycleDays < MINIMUM_CYCLE_DAYS || cycleDays > MAXIMUM_CYCLE_DAYS) return null

  const latest = [...history.purchasedAt].sort((left, right) => right.getTime() - left.getTime())[0]
  if (!latest) return null

  const daysSinceLast = Math.floor((now.getTime() - latest.getTime()) / MS_PER_DAY)
  if (daysSinceLast < 0) return null

  const progress = daysSinceLast / cycleDays
  if (progress < 1 - tolerance) return null

  return {
    sku: history.sku,
    cycleDays,
    purchases: history.purchasedAt.length,
    daysSinceLast,
    progress: Math.round(progress * 100) / 100,
  }
}

/**
 * Which cycle a due reminder belongs to, so the claim key can make it once-per-cycle rather than once ever.
 *
 * A reorder reminder is emphatically NOT a once-ever event — that is the whole point of the feature — but it must
 * not arrive daily either once somebody is overdue. Numbering the cycles gives each one its own claim: cycle 3 of
 * a 30-day coffee habit is claimed once, and cycle 4 is a new claim thirty days later.
 */
export function cycleNumber(cycle: ReorderCycle): number {
  return Math.max(1, Math.floor(cycle.daysSinceLast / cycle.cycleDays) + 1)
}
