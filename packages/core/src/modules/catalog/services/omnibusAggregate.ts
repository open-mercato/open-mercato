import type { EntityManager } from '@mikro-orm/postgresql'
import { sql } from 'kysely'
import { OFFERED_CHANGE_TYPES } from '../lib/omnibusTypes'
import type { OmnibusHistoryRow, OmnibusMinimizationAxis } from '../lib/omnibusTypes'

// Parameterised from the same constant the in-memory twin filters on, so the SQL and the TypeScript
// cannot drift apart on which change types may become a reference.
const offeredChangeTypes = sql.join(
  OFFERED_CHANGE_TYPES.map((changeType) => sql`${changeType}`),
  sql`, `,
)

/**
 * The three rows a scope needs to produce a reference price. Everything else the window contains
 * is irrelevant to the answer, so the database never sends it.
 */
export type OmnibusScopeAggregate = {
  /** Cheapest candidate on the minimisation axis — the reference price itself. */
  lowest: OmnibusHistoryRow | null
  /** Cheapest row of the newest instant at or before the window start — the "previous" price. */
  baselineLowest: OmnibusHistoryRow | null
  /** Oldest candidate, used for `coverageStartAt` when no baseline survived. */
  oldest: OmnibusHistoryRow | null
}

/**
 * The row's value on the axis being minimised, or NaN when it has none.
 *
 * NaN rather than `Number(null) === 0`: a row with no value on the axis has no price to compare,
 * and zero would make it win every comparison outright. Mirrors `nulls last` in the SQL ordering,
 * and both the in-memory selection and the cleanup of the SQL result read it, so "has no usable
 * value" means one thing in this file rather than two.
 */
function axisValue(row: OmnibusHistoryRow | null | undefined, axis: OmnibusMinimizationAxis): number {
  const raw = axis === 'net' ? row?.unitPriceNet : row?.unitPriceGross
  return raw === null || raw === undefined ? Number.NaN : Number(raw)
}

export type OmnibusAggregateScope = {
  key: string
  offerId: string | null
  variantId: string | null
  productId: string | null
  priceKindId: string
  currencyCode: string
  channelId: string | null
  windowStart: Date
  windowEnd: Date
  anchor: Date | null
  presented: OmnibusHistoryRow | null
}

/**
 * The same selection the SQL performs, over rows already in memory.
 *
 * Production always runs the SQL. This exists because moving the resolution into SQL moved it out
 * of reach of the mocked unit tests, and those tests are where the Omnibus rules themselves are
 * pinned — EC-7, the `change_type` filter, the tie-breaks, the baseline instant. Rather than lose
 * that coverage, the tests drive this function through the executor seam and a parity test proves
 * the two agree on real PostgreSQL. Keep the two in lockstep: any change to one is a change to both.
 */
export function selectScopeAggregate(
  rows: OmnibusHistoryRow[],
  scope: OmnibusAggregateScope,
  axis: OmnibusMinimizationAxis,
): OmnibusScopeAggregate {
  const value = (row: OmnibusHistoryRow) => axisValue(row, axis)
  const anchorMs = scope.anchor ? scope.anchor.getTime() : null
  const startMs = scope.windowStart.getTime()
  const endMs = scope.windowEnd.getTime()

  const matched = rows.filter((row) => {
    if (!OFFERED_CHANGE_TYPES.includes(row.changeType as (typeof OFFERED_CHANGE_TYPES)[number])) return false
    const at = new Date(row.recordedAt).getTime()
    if (at > endMs) return false
    if (anchorMs !== null && at >= anchorMs) return false
    const presented = scope.presented
    if (
      presented &&
      row.priceId === presented.priceId &&
      row.changeType === presented.changeType &&
      row.recordedAt === presented.recordedAt
    ) {
      return false
    }
    return true
  })

  const beforeStart = matched.filter((row) => new Date(row.recordedAt).getTime() <= startMs)
  const baselineAt = beforeStart.length
    ? beforeStart.reduce((max, row) => (row.recordedAt > max ? row.recordedAt : max), beforeStart[0]!.recordedAt)
    : null
  const isBaseline = (row: OmnibusHistoryRow) => baselineAt !== null && row.recordedAt === baselineAt
  const candidates = matched.filter((row) => new Date(row.recordedAt).getTime() > startMs || isBaseline(row))

  // `axis ASC NULLS LAST, recorded_at ASC, id ASC` — identical to the window function's ordering.
  const byAxis = (list: OmnibusHistoryRow[]) => {
    let best: OmnibusHistoryRow | null = null
    for (const row of list) {
      if (!Number.isFinite(value(row))) continue
      if (
        best === null ||
        value(row) < value(best) ||
        (value(row) === value(best) &&
          (row.recordedAt < best.recordedAt || (row.recordedAt === best.recordedAt && row.id < best.id)))
      ) {
        best = row
      }
    }
    return best
  }
  const oldest = candidates.reduce<OmnibusHistoryRow | null>(
    (acc, row) =>
      acc === null ||
      row.recordedAt < acc.recordedAt ||
      (row.recordedAt === acc.recordedAt && row.id < acc.id)
        ? row
        : acc,
    null,
  )

  return {
    lowest: byAxis(candidates),
    baselineLowest: byAxis(candidates.filter(isBaseline)),
    oldest,
  }
}

function toRow(raw: Record<string, unknown>): OmnibusHistoryRow {
  const asString = (value: unknown): string | null =>
    value === null || value === undefined ? null : String(value)
  return {
    id: String(raw.id),
    priceId: String(raw.price_id),
    changeType: String(raw.change_type),
    unitPriceNet: asString(raw.unit_price_net),
    unitPriceGross: asString(raw.unit_price_gross),
    recordedAt: new Date(raw.recorded_at as string).toISOString(),
    startsAt: raw.starts_at ? new Date(raw.starts_at as string).toISOString() : null,
    offerId: raw.offer_id ? String(raw.offer_id) : null,
    isAnnounced: raw.is_announced === null || raw.is_announced === undefined ? null : Boolean(raw.is_announced),
  }
}

/**
 * The id of the newest history row for each of `priceIds` — the "presented entry" identity.
 *
 * Exists to bound the products-list batch. Reading every history row for a page of prices and
 * keeping the first per id is unbounded in the size of the log: one row is written per price
 * mutation, so a price changed daily for two years contributes ~730 rows, and a hundred of them
 * materialise tens of thousands on a request path. That is the same defect review finding 7
 * described on the progressive-reduction read, one path over.
 *
 * Returning ids rather than rows keeps two properties that matter. The result is exactly one row
 * per price, so the follow-up read is bounded by the page. And the row contents still come back
 * through `findWithDecryption` (M-7) — this statement selects two uuids and decides nothing about
 * a price, so there is nothing here that decryption would have supplied.
 *
 * `distinct on … order by price_id, recorded_at desc, id desc` is the batched spelling of the
 * per-item query's `orderBy: { recordedAt: 'DESC', id: 'DESC' }, limit: 1`, tie-break included, so
 * the batched and per-item paths cannot select different entries (M-3).
 */
export async function latestHistoryEntryIdsByPrice(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  priceIds: string[],
): Promise<string[]> {
  if (!priceIds.length) return []
  const db = em.getKysely<never>() as never
  const query = sql<{ id: string }>`
    select distinct on (price_id) id
    from catalog_price_history_entries
    where tenant_id = ${scope.tenantId}::uuid
      and organization_id = ${scope.organizationId}::uuid
      and price_id = any(${priceIds}::uuid[])
    order by price_id, recorded_at desc, id desc
  `
  const executed = (await query.execute(db)) as { rows?: { id: string }[] }
  return (executed.rows ?? []).map((row) => String(row.id))
}

/**
 * How a page's scopes get resolved. The SQL implementation below is the only one used in
 * production; the seam exists so tests can substitute an in-memory equivalent (see
 * `selectScopeAggregate`) without a live database.
 */
export type OmnibusAggregateExecutor = (
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  axis: OmnibusMinimizationAxis,
  scopes: OmnibusAggregateScope[],
) => Promise<Map<string, OmnibusScopeAggregate>>

/**
 * Resolve the reference candidates for many scopes in one statement.
 *
 * Requested by review on PR #5192: push the `MIN` over the minimisation axis into SQL, together
 * with every filter that decides whether a row may be a reference at all. The database then returns
 * at most three rows per scope instead of the window's contents, which is what removes the row cap
 * the in-memory scan needed — a cap that could silently drop the true minimum.
 *
 * Ordering matches `selectScopeAggregate` exactly (`axis ASC NULLS LAST, recorded_at ASC, id ASC`
 * for the two minima, `recorded_at ASC, id ASC` for the oldest), so the two cannot disagree.
 *
 * This is a deliberate, reviewer-sanctioned exception to the "catalog reads go through
 * `findWithDecryption`" rule (M-7), and it is safe for these columns specifically: `unit_price_net`
 * and `unit_price_gross` are `numeric(16,4)`, and a numeric column cannot hold ciphertext, so the
 * comparison cannot silently degrade the way it would on an encryptable text column. Do not copy
 * this pattern onto fields that can enter an encryption map.
 */
export async function aggregateOmnibusScopes(
  em: EntityManager,
  scope: { tenantId: string; organizationId: string },
  axis: OmnibusMinimizationAxis,
  scopes: OmnibusAggregateScope[],
): Promise<Map<string, OmnibusScopeAggregate>> {
  const result = new Map<string, OmnibusScopeAggregate>()
  if (!scopes.length) return result
  // Seeded empty so a scope the window holds nothing for reads as "no candidates" rather than
  // undefined — computeLowestPrice distinguishes the two.
  for (const entry of scopes) result.set(entry.key, { lowest: null, baselineLowest: null, oldest: null })

  const db = em.getKysely<never>() as never
  // Whitelisted by the axis union type; never interpolated from request input.
  const axisColumn = axis === 'net' ? sql.ref('unit_price_net') : sql.ref('unit_price_gross')

  const values = sql.join(
    scopes.map(
      (entry) => sql`(
        ${entry.key}::text,
        ${entry.offerId}::uuid,
        ${entry.variantId}::uuid,
        ${entry.productId}::uuid,
        ${entry.priceKindId}::uuid,
        ${entry.currencyCode}::text,
        ${entry.channelId}::uuid,
        ${entry.windowStart}::timestamptz,
        ${entry.windowEnd}::timestamptz,
        ${entry.anchor}::timestamptz,
        ${entry.presented?.priceId ?? null}::uuid,
        ${entry.presented?.changeType ?? null}::text,
        ${entry.presented ? new Date(entry.presented.recordedAt) : null}::timestamptz
      )`,
    ),
    sql`, `,
  )

  // Narrow on a column only in the shape the scope set actually needs.
  //
  // The obvious spelling, `(s.product_id is null or h.product_id = s.product_id)`, is uniform but
  // costly: the disjunction is opaque to the planner, so once `scopes` holds more than one row it
  // stops being a join key and becomes a per-row filter. Measured on 110k rows across a 100-scope
  // page, that is 265ms against 20ms for the plain equality — the same plan shape, 13x the time.
  // Every caller builds its scopes from one code path, so in practice a column is either set on
  // all of them or on none; the disjunction is kept only for the mixed case, which stays correct.
  const narrowOn = (
    column: 'offer_id' | 'variant_id' | 'product_id' | 'channel_id',
    values: (string | null)[],
  ) => {
    if (values.every((value) => value === null)) return null
    const scopeRef = sql.ref(`s.${column}`)
    const historyRef = sql.ref(`h.${column}`)
    if (values.every((value) => value !== null)) return sql`and ${historyRef} = ${scopeRef}`
    return sql`and (${scopeRef} is null or ${historyRef} = ${scopeRef})`
  }
  const narrowing = sql.join(
    (
      [
        narrowOn('offer_id', scopes.map((entry) => entry.offerId)),
        narrowOn('variant_id', scopes.map((entry) => entry.variantId)),
        narrowOn('product_id', scopes.map((entry) => entry.productId)),
        narrowOn('channel_id', scopes.map((entry) => entry.channelId)),
      ] as const
    ).filter((fragment): fragment is NonNullable<typeof fragment> => fragment !== null),
    sql` `,
  )

  const query = sql<Record<string, unknown>>`
    with scopes (key, offer_id, variant_id, product_id, price_kind_id, currency_code, channel_id,
                 window_start, window_end, anchor,
                 presented_price_id, presented_change_type, presented_recorded_at) as (
      values ${values}
    ),
    matched as (
      -- recorded_at is truncated to milliseconds here and used truncated everywhere below.
      -- The column is timestamptz(6); JS Dates only carry milliseconds, so a row written with
      -- microseconds would compare unequal to a presented entry that had round-tripped through
      -- JS, and the announced reduction would survive its own EC-7 exclusion. Truncating once
      -- makes every comparison below identical to the one selectScopeAggregate performs.
      select s.key, s.window_start, s.window_end, s.anchor,
             s.presented_price_id, s.presented_change_type, s.presented_recorded_at,
             h.id, h.price_id, h.change_type, h.unit_price_net, h.unit_price_gross,
             date_trunc('milliseconds', h.recorded_at) as recorded_at,
             h.starts_at, h.offer_id, h.is_announced
      from scopes s
      join catalog_price_history_entries h
        on h.tenant_id = ${scope.tenantId}::uuid
       and h.organization_id = ${scope.organizationId}::uuid
       and h.price_kind_id = s.price_kind_id
       and h.currency_code = s.currency_code
       ${narrowing}
       and h.change_type in (${offeredChangeTypes})
       -- Only an upper bound, and deliberately so: the baseline is "the newest instant at or
       -- before the window opens", which has no lower bound to give it. Bounding this at
       -- window_start and resolving the baseline separately was measured and rejected — the
       -- extra correlated read cost far more than the rows it saved.
       -- Coarse bound on the raw column so the lookback indexes still apply; the exact
       -- truncated bounds are enforced in the bounded CTE.
       and h.recorded_at < s.window_end + interval '1 millisecond'
    ),
    bounded as (
      select * from matched
      where recorded_at <= window_end
        and (anchor is null or recorded_at < anchor)
        and not (
          presented_price_id is not null
          and price_id = presented_price_id
          and change_type = presented_change_type
          and recorded_at = presented_recorded_at
        )
    ),
    baseline_at as (
      select key, max(recorded_at) as at
      from bounded
      where recorded_at <= window_start
      group by key
    ),
    candidates as (
      select m.*, (b.at is not null and m.recorded_at = b.at) as is_baseline
      from bounded m
      left join baseline_at b on b.key = m.key
      where m.recorded_at > m.window_start
         or (b.at is not null and m.recorded_at = b.at)
    ),
    ranked as (
      select c.*,
             row_number() over (
               partition by c.key
               order by ${axisColumn} asc nulls last, c.recorded_at asc, c.id asc
             ) as rn_low,
             row_number() over (
               partition by c.key order by c.recorded_at asc, c.id asc
             ) as rn_old,
             row_number() over (
               partition by c.key, c.is_baseline
               order by ${axisColumn} asc nulls last, c.recorded_at asc, c.id asc
             ) as rn_base
      from candidates c
    )
    select key, id, price_id, change_type, unit_price_net, unit_price_gross,
           recorded_at, starts_at, offer_id, is_announced,
           rn_low, rn_old, rn_base, is_baseline
    from ranked
    where rn_low = 1 or rn_old = 1 or (is_baseline and rn_base = 1)
  `

  const executed = (await query.execute(db)) as { rows?: Record<string, unknown>[] }
  for (const raw of executed.rows ?? []) {
    const entry = result.get(String(raw.key))
    if (!entry) continue
    const row = toRow(raw)
    if (Number(raw.rn_low) === 1) entry.lowest = row
    if (Number(raw.rn_old) === 1) entry.oldest = row
    if (raw.is_baseline === true && Number(raw.rn_base) === 1) entry.baselineLowest = row
  }

  // `nulls last` means a row with no value on the minimisation axis still wins when it is the only
  // candidate. `selectScopeAggregate` skips non-finite values outright, so both minima are dropped
  // here to match — and the match matters beyond parity: an empty `baselineLowest` is what makes
  // `computeLowestPrice` report `insufficientHistory`, so leaving a valueless row in it would
  // present an incomplete history as a complete one.
  for (const entry of result.values()) {
    if (!Number.isFinite(axisValue(entry.lowest, axis))) entry.lowest = null
    if (!Number.isFinite(axisValue(entry.baselineLowest, axis))) entry.baselineLowest = null
  }
  return result
}
