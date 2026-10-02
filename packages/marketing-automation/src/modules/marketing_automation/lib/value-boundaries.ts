import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingValueBoundaries } from '../data/entities.js'
import { EMPTY_VALUE_BOUNDARIES, RFM_BUCKETS } from './engine/rfm.js'
import type { ValueBoundaries } from './engine/rfm.js'
import { PLACED_ORDER_FILTER_SQL } from './order-filter.js'
import { SALES_ORDERS } from './external/tables.js'

/** Declared locally rather than imported from the document builder, which imports this file. */
type BoundaryScope = { tenantId: string; organizationId: string }

/**
 * Computing and reading the cut points RFM is scored against.
 *
 * The computation is one statement, deliberately. Every alternative — loading buyers into memory, or asking
 * per customer — is either unbounded or quadratic, and Postgres computes percentiles over an aggregate far
 * better than JavaScript can over a result set.
 */

/** Percentile positions for the four quintile cut points. */
const QUINTILE_FRACTIONS = Array.from({ length: RFM_BUCKETS - 1 }, (_, index) => (index + 1) / RFM_BUCKETS)

/** Nineteen positions, so a customer's spend can be placed to the nearest 5th percentile. */
const PERCENTILE_FRACTIONS = Array.from({ length: 19 }, (_, index) => (index + 1) / 20)

function fractionArray(fractions: number[]): string {
  return `array[${fractions.map((fraction) => fraction.toFixed(4)).join(', ')}]`
}

/**
 * One statement over the shop's buyers.
 *
 * Grouped per customer first, then aggregated across customers: a percentile over ORDERS would answer a
 * different question ("the median order"), and RFM is about customers. The order filter is the module's shared
 * definition of an order that counts, so the boundaries rank the same orders every audience does.
 */
const BOUNDARIES_SQL = `
  with buyers as (
    select customer_entity_id,
           count(*)::int as order_count,
           sum(grand_total_gross_amount)::float8 as total_gross,
           extract(epoch from (now() - max(placed_at))) / 86400.0 as days_since_last
      from ${SALES_ORDERS}
     where customer_entity_id is not null
       and ${PLACED_ORDER_FILTER_SQL}
     group by customer_entity_id
  )
  select
    count(*)::int as buyer_count,
    percentile_cont(${fractionArray(QUINTILE_FRACTIONS)}) within group (order by days_since_last) as recency_days,
    percentile_cont(${fractionArray(QUINTILE_FRACTIONS)}) within group (order by order_count) as frequency,
    percentile_cont(${fractionArray(QUINTILE_FRACTIONS)}) within group (order by total_gross) as monetary,
    percentile_cont(${fractionArray(PERCENTILE_FRACTIONS)}) within group (order by total_gross) as gross_percentiles
  from buyers
`

type BoundariesRow = {
  buyer_count: number
  recency_days: number[] | null
  frequency: number[] | null
  monetary: number[] | null
  gross_percentiles: number[] | null
}

function readNumbers(value: unknown, expected: number): number[] {
  if (!Array.isArray(value) || value.length !== expected) return []
  const numbers = value.map((entry) => (typeof entry === 'number' ? entry : Number(entry)))
  return numbers.every((entry) => Number.isFinite(entry)) ? numbers : []
}

/**
 * Recomputes the cut points for one scope and stores them.
 *
 * Called by the daily sweep. Idempotent by the unique index on the scope: recomputing twice in a day costs one
 * redundant statement and never creates a second row, which is the same guarantee the segment snapshot gets
 * from its one-per-day index.
 */
export async function refreshValueBoundaries(
  em: EntityManager,
  scope: BoundaryScope,
  now: Date,
): Promise<ValueBoundaries> {
  const rows = await em.getConnection().execute<BoundariesRow[]>(
    BOUNDARIES_SQL,
    [scope.tenantId, scope.organizationId],
  )
  const row = rows[0]

  const computed: ValueBoundaries = {
    recencyDays: readNumbers(row?.recency_days, RFM_BUCKETS - 1),
    frequency: readNumbers(row?.frequency, RFM_BUCKETS - 1),
    monetary: readNumbers(row?.monetary, RFM_BUCKETS - 1),
    grossPercentiles: readNumbers(row?.gross_percentiles, PERCENTILE_FRACTIONS.length),
    buyerCount: row?.buyer_count ?? 0,
    computedAt: now.toISOString(),
  }

  const existing = await em.findOne(MarketingValueBoundaries, { ...scope })
  if (existing) {
    existing.boundaries = computed as unknown as Record<string, unknown>
    existing.buyerCount = computed.buyerCount
    existing.computedAt = now
    await em.flush()
    return computed
  }

  const created = em.create(MarketingValueBoundaries, {
    ...scope,
    boundaries: computed as unknown as Record<string, unknown>,
    buyerCount: computed.buyerCount,
    computedAt: now,
  })
  em.persist(created)
  await em.flush()
  return computed
}

/**
 * Reads the stored cut points, or the empty set.
 *
 * Empty is a legitimate answer and produces no scores rather than a fallback score — a made-up boundary would
 * put every customer in a bucket and none of those buckets would mean anything.
 */
export async function loadValueBoundaries(
  em: EntityManager,
  scope: BoundaryScope,
): Promise<ValueBoundaries> {
  const row = await em.findOne(MarketingValueBoundaries, { ...scope })
  if (!row) return EMPTY_VALUE_BOUNDARIES
  const stored = row.boundaries as Partial<ValueBoundaries> | null
  return {
    recencyDays: readNumbers(stored?.recencyDays, RFM_BUCKETS - 1),
    frequency: readNumbers(stored?.frequency, RFM_BUCKETS - 1),
    monetary: readNumbers(stored?.monetary, RFM_BUCKETS - 1),
    grossPercentiles: readNumbers(stored?.grossPercentiles, PERCENTILE_FRACTIONS.length),
    buyerCount: row.buyerCount,
    computedAt: row.computedAt ? row.computedAt.toISOString() : null,
  }
}

/**
 * How long a set of cut points stays usable before it is worth recomputing.
 *
 * The boundaries are percentiles over every buyer in the tenant, which is the most expensive statement
 * this module runs. They answer "where does the top fifth of our customers start", and that does not
 * move measurably between one hour and the next — so recomputing on every hourly tick spent the whole
 * cost twenty-four times a day to produce the same numbers.
 */
export const VALUE_BOUNDARY_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Refreshes the cut points only when they are missing or a day old.
 *
 * Missing matters more than stale: on an installation that has never swept there is no row at all, and a
 * published "top 20% spenders" campaign enrolled nobody on its first pass because the projection read
 * boundaries that did not exist yet. So an absent row refreshes immediately, whatever the clock says.
 */
export async function refreshValueBoundariesIfStale(
  em: EntityManager,
  scope: BoundaryScope,
  now: Date,
): Promise<{ refreshed: boolean; boundaries: ValueBoundaries }> {
  const current = await loadValueBoundaries(em, scope)
  const computedAt = current.computedAt ? Date.parse(current.computedAt) : null
  const fresh = computedAt !== null
    && Number.isFinite(computedAt)
    && now.getTime() - computedAt < VALUE_BOUNDARY_MAX_AGE_MS
  if (fresh) return { refreshed: false, boundaries: current }
  return { refreshed: true, boundaries: await refreshValueBoundaries(em, scope, now) }
}
