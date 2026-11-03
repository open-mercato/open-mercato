/**
 * RFM scoring and a value projection, both derived — never stored on the customer.
 *
 * **The decision that shapes this file: RFM is measured against the SHOP, not against fixed numbers.**
 * "Bought in the last 30 days" is excellent for a coffee subscription and terrible for a mattress shop, so a
 * recency score built on hard-coded day counts is wrong for every shop but one. The scores here are quintiles
 * over the tenant's own buyers: a 5 for recency means "in the most recent fifth of this shop's customers",
 * which is the only version of the number that means the same thing everywhere.
 *
 * The boundaries themselves are expensive — a percentile over every buyer — so they are computed once a day by
 * the sweep and read here as data. This module keeps `lib/engine/` free of I/O, which is what makes the rules
 * below testable without a database.
 */

/** The number of buckets. Five is what RFM means; this is not a knob. */
export const RFM_BUCKETS = 5

/**
 * Boundaries for one dimension: `RFM_BUCKETS - 1` cut points, ascending.
 *
 * Four numbers describing five buckets. An empty array means "not enough data to rank anybody", which is a
 * real state on a new installation and produces no scores rather than a confident 3.
 */
export type DimensionBoundaries = number[]

export type ValueBoundaries = {
  /**
   * Days since the last order, ascending — so a LOW value is a GOOD score, which is the one dimension that
   * inverts. Getting this backwards silently mails the most engaged fifth of customers a win-back message.
   */
  recencyDays: DimensionBoundaries
  /** Order count, ascending: more is better. */
  frequency: DimensionBoundaries
  /** Lifetime gross, ascending: more is better. */
  monetary: DimensionBoundaries
  /**
   * Nineteen cut points over lifetime gross, so a customer's position can be reported to the nearest 5th
   * percentile. Separate from `monetary` because a quintile is what an audience compares and a percentile is
   * what a person reading a profile understands.
   */
  grossPercentiles: DimensionBoundaries
  /** How many buyers the boundaries were computed over, so a caller can distrust a tiny sample. */
  buyerCount: number
  computedAt: string | null
}

export const EMPTY_VALUE_BOUNDARIES: ValueBoundaries = {
  recencyDays: [],
  frequency: [],
  monetary: [],
  grossPercentiles: [],
  buyerCount: 0,
  computedAt: null,
}

/**
 * Below this many buyers, quintiles are noise dressed as insight.
 *
 * Twenty buyers means four per bucket, which is already thin; below it the boundaries move every day and a
 * customer's "score" changes without the customer doing anything. The same reasoning as the minimum evidence
 * for a learned send hour and the minimum sample for an A/B winner: a confident answer from too little data is
 * worse than no answer, because somebody acts on it.
 */
export const MINIMUM_BUYERS_FOR_RFM = 20

function isUsable(boundaries: DimensionBoundaries): boolean {
  return boundaries.length === RFM_BUCKETS - 1 && boundaries.every((value) => Number.isFinite(value))
}

/**
 * The bucket a value falls in, 1–5, where a HIGHER value scores higher.
 *
 * Boundaries are treated as inclusive upper bounds of each lower bucket, so a value exactly on a cut point
 * scores in the lower bucket. Arbitrary, and stated because consistency is what matters: the same rule is
 * applied to every dimension, so two customers with identical numbers always score identically.
 */
export function ascendingBucket(value: number, boundaries: DimensionBoundaries): number | null {
  if (!isUsable(boundaries)) return null
  if (!Number.isFinite(value)) return null
  let bucket = 1
  for (const cut of boundaries) {
    if (value > cut) bucket += 1
  }
  return bucket
}

/** The bucket where a LOWER value scores higher — recency, and only recency. */
export function descendingBucket(value: number, boundaries: DimensionBoundaries): number | null {
  const ascending = ascendingBucket(value, boundaries)
  return ascending === null ? null : RFM_BUCKETS + 1 - ascending
}

export type RfmScores = {
  recency: number
  frequency: number
  monetary: number
  /** The three digits as an operator writes them, e.g. `543`. Display only; audiences compare the digits. */
  cell: string
  /** The three added together, 3–15, for sorting one list by "best customers". */
  total: number
}

export type OrderFacts = {
  count: number
  totalGross: number
  daysSinceLast?: number
  /** ISO, used only to work out how long the customer has been buying. */
  firstPlacedAt?: string
}

/**
 * RFM for one customer, or null.
 *
 * Null — not a zero score — for anybody who has never ordered, and for a shop with too few buyers to rank
 * against. A never-buyer with `recency: 1` would look like a lapsed customer and be swept into win-back
 * campaigns, which is the same class of mistake as a null `daysSinceLast` comparing as zero.
 */
export function computeRfm(orders: OrderFacts, boundaries: ValueBoundaries): RfmScores | null {
  if (orders.count <= 0) return null
  if (orders.daysSinceLast === undefined) return null
  if (boundaries.buyerCount < MINIMUM_BUYERS_FOR_RFM) return null

  const recency = descendingBucket(orders.daysSinceLast, boundaries.recencyDays)
  const frequency = ascendingBucket(orders.count, boundaries.frequency)
  const monetary = ascendingBucket(orders.totalGross, boundaries.monetary)
  if (recency === null || frequency === null || monetary === null) return null

  return {
    recency,
    frequency,
    monetary,
    cell: `${recency}${frequency}${monetary}`,
    total: recency + frequency + monetary,
  }
}

/**
 * The customer's position among the shop's buyers by lifetime spend, to the nearest 5th percentile.
 *
 * Derived from stored cut points rather than from the live distribution, so the granularity is 5 and that is
 * said out loud: claiming "the 87th percentile" from nineteen boundaries would be a precision nobody
 * computed.
 *
 * The number reported is the FLOOR of the bucket the customer is in, so the top 5% of buyers report 95 rather
 * than 100 — there is no cut point above them to place them more precisely, and rounding them up to 100 would
 * claim the shop has a single best customer when it has a top twentieth.
 */
export function grossPercentile(totalGross: number, boundaries: ValueBoundaries): number | null {
  const cuts = boundaries.grossPercentiles
  if (cuts.length === 0 || !Number.isFinite(totalGross)) return null
  if (boundaries.buyerCount < MINIMUM_BUYERS_FOR_RFM) return null
  let below = 0
  for (const cut of cuts) {
    if (totalGross > cut) below += 1
  }
  return Math.round((below / (cuts.length + 1)) * 100)
}

const MS_PER_DAY = 86_400_000

/** How far ahead a projection looks, in years. A tenant setting; two years is a common planning horizon. */
export const DEFAULT_VALUE_HORIZON_YEARS = 2

export type ProjectedValue = {
  /** Lifetime gross divided by order count. Available from the first order. */
  averageOrderGross: number
  /**
   * Orders per year at the customer's observed cadence, ABSENT until there is a cadence to observe.
   *
   * One order is not a rate. Projecting from a single purchase would rank a first-time buyer who spent a lot
   * above a loyal customer who spends steadily, which is the opposite of what the number is for.
   */
  ordersPerYear?: number
  /** `averageOrderGross × ordersPerYear`, absent for the same reason. */
  projectedAnnualGross?: number
  /** The annual figure over the horizon. A PROJECTION of behaviour continuing, and labelled as one. */
  projectedHorizonGross?: number
}

/**
 * A value projection from the customer's own observed cadence.
 *
 * Deliberately arithmetic rather than a model: BG/NBD with Gamma-Gamma would be a better predictor and a
 * worse feature here — it needs fitting, it needs explaining, and an operator cannot sanity-check its output.
 * "This customer buys 4 times a year at 80 each, so about 640 over two years if they carry on" is a number
 * somebody can argue with, which is what makes it usable for targeting.
 */
export function projectCustomerValue(
  orders: OrderFacts,
  now: Date,
  horizonYears: number = DEFAULT_VALUE_HORIZON_YEARS,
): ProjectedValue | null {
  if (orders.count <= 0 || !Number.isFinite(orders.totalGross)) return null

  const averageOrderGross = orders.totalGross / orders.count
  const projection: ProjectedValue = { averageOrderGross }

  if (orders.count < 2 || !orders.firstPlacedAt) return projection

  const firstAt = new Date(orders.firstPlacedAt)
  if (Number.isNaN(firstAt.getTime())) return projection

  /**
   * The observation window is first order → now, not first → last.
   *
   * Using the last order would make somebody who bought twice in one week and then vanished look like a
   * hundred-orders-a-year customer forever. Counting the silence since is what keeps the rate honest.
   */
  const days = Math.max(1, (now.getTime() - firstAt.getTime()) / MS_PER_DAY)
  const ordersPerYear = (orders.count / days) * 365
  if (!Number.isFinite(ordersPerYear) || ordersPerYear <= 0) return projection

  projection.ordersPerYear = Math.round(ordersPerYear * 100) / 100
  projection.projectedAnnualGross = Math.round(averageOrderGross * ordersPerYear * 100) / 100
  projection.projectedHorizonGross = Math.round(averageOrderGross * ordersPerYear * horizonYears * 100) / 100
  return projection
}
