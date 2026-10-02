import type { EntityManager } from '@mikro-orm/postgresql'
import { MarketingProductWatch } from '../data/entities.js'
import { decidePriceDrop, nextReferencePrice } from './engine/price-watch.js'
import type { PriceDropDecision } from './engine/price-watch.js'
import {
  CATALOG_PRODUCTS,
  CATALOG_PRODUCT_VARIANTS,
  CATALOG_PRODUCT_VARIANT_PRICES,
} from './external/tables.js'

/**
 * Price watches: reading the current price, scanning the watches, and what fires.
 *
 * **Back-in-stock is not here, and that is a dependency rather than an omission.** The platform has no
 * availability contract yet (`.ai/specs/2026-08-14-availability-contract.md` is unimplemented): stock lives in
 * `wms` inventory balances, which is an optional module, and reading its tables from here would be exactly the
 * cross-module coupling this codebase forbids. The moment `availabilityService` exists, the second scan is a
 * few dozen lines against this same table.
 */

export type WatchScope = { tenantId: string; organizationId: string }

/**
 * The price a shopper would see, per SKU.
 *
 * Deliberately the UNTARGETED list price: `regular` kind, quantity one, no channel, user, group or customer
 * dimension, inside its validity window. A price targeted at somebody else is not this customer's price, and
 * telling them a drop happened because a contract price exists for a different buyer would be a lie they can
 * check in one click.
 */
const CURRENT_PRICE_SQL = `
  select coalesce(v.sku, pr.sku) as sku, min(p.unit_price_gross)::text as amount
    from ${CATALOG_PRODUCT_VARIANT_PRICES} p
    left join ${CATALOG_PRODUCT_VARIANTS} v on v.id = p.variant_id
    left join ${CATALOG_PRODUCTS} pr on pr.id = p.product_id
   where p.tenant_id = ? and p.organization_id = ?
     and p.currency_code = ?
     and p.kind = 'regular'
     and p.min_quantity <= 1
     and p.channel_id is null
     and p.user_id is null
     and p.user_group_id is null
     and p.customer_id is null
     and p.customer_group_id is null
     and (p.starts_at is null or p.starts_at <= now())
     and (p.ends_at is null or p.ends_at > now())
     and p.unit_price_gross is not null
     and (v.id is null or (v.deleted_at is null and v.is_active = true))
     and (pr.id is null or (pr.deleted_at is null and pr.is_active = true))
     and coalesce(v.sku, pr.sku) in (SKU_PLACEHOLDERS)
   group by 1
`

/** Current prices for a set of SKUs, in one query. A query per watch would make a scan quadratic in nothing. */
export async function loadCurrentPrices(
  em: EntityManager,
  scope: WatchScope,
  currencyCode: string,
  skus: string[],
): Promise<Map<string, string>> {
  if (skus.length === 0) return new Map()
  /**
   * Placeholders expanded, rather than `= any(?)` with an array parameter.
   *
   * Passing a JS array to `any(?)` through the ORM's raw executor produced a driver error rather than a
   * binding — the SKUs are still parameters, one each, so nothing is interpolated into the statement.
   */
  const sql = CURRENT_PRICE_SQL.replace('SKU_PLACEHOLDERS', skus.map(() => '?').join(', '))
  const rows = await em.getConnection().execute<Array<{ sku: string | null; amount: string | null }>>(
    sql,
    [scope.tenantId, scope.organizationId, currencyCode, ...skus],
  )
  const prices = new Map<string, string>()
  for (const row of rows) {
    if (row.sku && row.amount) prices.set(row.sku, row.amount)
  }
  return prices
}

export type WatchCreation = {
  watch: MarketingProductWatch
  created: boolean
}

/**
 * Starts (or returns) a watch, with the current price as its reference.
 *
 * Idempotent per customer and SKU: asking twice does not create a second watch and — importantly — does not
 * reset the reference price, because that would silently cancel a drop the customer was already owed.
 */
export async function startWatch(
  em: EntityManager,
  scope: WatchScope,
  input: { subjectEntityId: string; sku: string; currencyCode: string },
): Promise<WatchCreation> {
  const existing = await em.findOne(MarketingProductWatch, {
    ...scope,
    subjectEntityId: input.subjectEntityId,
    sku: input.sku,
    deletedAt: null,
  })
  if (existing) return { watch: existing, created: false }

  const prices = await loadCurrentPrices(em, scope, input.currencyCode, [input.sku])
  const watch = em.create(MarketingProductWatch, {
    ...scope,
    subjectEntityId: input.subjectEntityId,
    sku: input.sku,
    currencyCode: input.currencyCode,
    // Null when the SKU has no price a shopper could see. The watch is still valid — a price appearing later
    // simply becomes its reference on the first scan.
    watchedPriceGross: prices.get(input.sku) ?? null,
  })
  em.persist(watch)
  await em.flush()
  return { watch, created: true }
}

export type WatchFiring = {
  watch: MarketingProductWatch
  decision: Extract<PriceDropDecision, { fire: true }>
}

export type ScanOutcome = {
  scanned: number
  fired: WatchFiring[]
  /** Counted per reason, so the admin screen can say why nothing fired. */
  reasons: Record<string, number>
}

/**
 * Compares every live watch against today's price.
 *
 * Grouped by currency so each group is one price query, and the reference price is updated whether or not the
 * watch fired — a watch whose product got dearer must be measured from the new, higher price the next time it
 * drops, or a customer gets told about a "drop" that only undoes a rise.
 */
export async function scanPriceWatches(
  em: EntityManager,
  scope: WatchScope,
  now: Date,
  options: { limit?: number } = {},
): Promise<ScanOutcome> {
  /**
   * Least recently scanned first, which turns the per-tick cap into a rotation.
   *
   * It used to be oldest-by-creation, so an installation with more watches than the cap re-read the same rows
   * on every tick and everything past it was never looked at once — a customer waiting on a price they would
   * never be told about, and nothing anywhere saying so. Nulls sort first, so a watch that has never been
   * scanned goes before one that has.
   */
  const watches = await em.find(
    MarketingProductWatch,
    { ...scope, deletedAt: null },
    { orderBy: { lastScannedAt: 'ASC NULLS FIRST', createdAt: 'ASC' }, limit: options.limit ?? 5_000 },
  )
  if (watches.length === 0) return { scanned: 0, fired: [], reasons: {} }

  const byCurrency = new Map<string, MarketingProductWatch[]>()
  for (const watch of watches) {
    const group = byCurrency.get(watch.currencyCode) ?? []
    group.push(watch)
    byCurrency.set(watch.currencyCode, group)
  }

  const fired: WatchFiring[] = []
  const reasons: Record<string, number> = {}

  for (const [currencyCode, group] of byCurrency) {
    const prices = await loadCurrentPrices(em, scope, currencyCode, [...new Set(group.map((watch) => watch.sku))])
    for (const watch of group) {
      const currentPriceGross = prices.get(watch.sku) ?? null
      const decision = decidePriceDrop({
        watchedPriceGross: watch.watchedPriceGross,
        currentPriceGross,
        notifiedAt: watch.notifiedAt,
        now,
      })

      if (decision.fire) {
        fired.push({ watch, decision })
        watch.notifiedAt = now
        watch.notifiedCount += 1
      } else {
        reasons[decision.reason] = (reasons[decision.reason] ?? 0) + 1
      }

      watch.watchedPriceGross = nextReferencePrice(decision, watch.watchedPriceGross, currentPriceGross) ?? null
    }
  }

  /**
   * Flushed BEFORE the events are emitted by the caller.
   *
   * The reference price and the notified timestamp are the only things stopping a redelivered scan from
   * telling the same customer twice, so they are committed first and the message is sent after.
   */
  await em.flush()
  /**
   * Stamped for every watch LOOKED at, not only the ones that fired.
   *
   * This is what makes the ordering above a rotation: a watch whose price has not moved is written nothing
   * else by this scan, so without this it would keep sorting first for ever and the cap would never advance.
   * One statement per tick, after the work, because a stamp written before it would skip a watch on a tick
   * that then failed.
   */
  await em.nativeUpdate(
    MarketingProductWatch,
    { id: { $in: watches.map((watch) => watch.id) }, ...scope },
    { lastScannedAt: now },
  )

  return { scanned: watches.length, fired, reasons }
}

export type WatchSummary = {
  sku: string
  currencyCode: string
  watchedPriceGross: string | null
  currentPriceGross: string | null
  notifiedAt: string | null
}

/** What the customer profile shows: what they are waiting for, and how the price has moved since. */
export async function loadWatchSummaries(
  em: EntityManager,
  scope: WatchScope,
  subjectEntityId: string,
): Promise<WatchSummary[]> {
  const watches = await em.find(
    MarketingProductWatch,
    { ...scope, subjectEntityId, deletedAt: null },
    { orderBy: { createdAt: 'DESC' }, limit: 50 },
  )
  if (watches.length === 0) return []

  const byCurrency = new Map<string, string[]>()
  for (const watch of watches) {
    byCurrency.set(watch.currencyCode, [...(byCurrency.get(watch.currencyCode) ?? []), watch.sku])
  }
  const currentByCurrency = new Map<string, Map<string, string>>()
  for (const [currencyCode, skus] of byCurrency) {
    currentByCurrency.set(currencyCode, await loadCurrentPrices(em, scope, currencyCode, skus))
  }

  return watches.map((watch) => ({
    sku: watch.sku,
    currencyCode: watch.currencyCode,
    watchedPriceGross: watch.watchedPriceGross ?? null,
    currentPriceGross: currentByCurrency.get(watch.currencyCode)?.get(watch.sku) ?? null,
    notifiedAt: watch.notifiedAt ? watch.notifiedAt.toISOString() : null,
  }))
}
