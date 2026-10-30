import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { sweepClaimKey } from './occurrence.js'
import { cycleNumber, MINIMUM_PURCHASES_FOR_CYCLE, reorderCycleFor } from './engine/reorder.js'
import { PLACED_ORDER_LINE_FILTER_SQL_ALIASED } from './order-filter.js'
import type { RunScope } from './runs.js'
import {
  CUSTOMER_ENTITIES,
  CUSTOMER_PEOPLE,
  SALES_ORDERS,
  SALES_ORDER_LINES,
} from './external/tables.js'
import type { MarketingCapabilities } from './capabilities.js'

/**
 * What a scheduled campaign iterates over.
 *
 * Two shapes exist and they are genuinely different, which is why this is a registry of ROW sources
 * rather than of everything: the `customers` source walks the population and is narrowed by the
 * campaign's own audience (see `lib/engine/narrowing.ts`), while a row source is driven by a query of
 * its own and hands back one candidate per row. Adding a row source is a query and a label; nothing
 * else in the sweep changes.
 */

export type SweepCandidate = {
  subjectEntityId: string
  /** Scalars the source contributes under `trigger.*`. */
  trigger: Record<string, unknown>
  /**
   * A durable claim, when the source must act on a thing exactly once ever.
   *
   * Enforced by the run table's occurrence index. Without it a source whose query keeps matching —
   * an order stays fulfilled forever — would re-enrol on every tick.
   */
  claimKey?: string
}

export type SweepSourceParams = { withinDays?: number }

export type RowSweepSource = {
  id: string
  labelKey: string
  available: boolean
  blockedReasonKey?: string
  /**
   * The module whose data this source reads, when that module is one this one can run without.
   *
   * `available` answers "is this source finished"; this answers "can this installation use it". The two are
   * separate questions and a source can fail either — an abandoned-cart source is unavailable because no cart
   * entity exists anywhere, while a reorder source is perfectly finished and simply has nothing to read on a
   * shop with no `sales` module. The palette says which, because "we have not built it" and "you have not
   * installed it" lead an operator to completely different next steps.
   */
  requiresModule?: 'sales' | 'catalog'
  /** The synthetic trigger id runs from this source are recorded under. */
  triggerEventId: string
  /** Paths the audience builder can offer for this source. */
  contextKeys: string[]
  /** Default for `withinDays` when the author did not set one. */
  defaultWithinDays: number
  /**
   * True when `collect` hydrates ORM entities rather than returning plain rows.
   *
   * It decides how the worker reads the source, and the two answers are opposite. An entity source must be
   * read a page at a time, because a tick's worth of them sits in the identity map at once. A raw-SQL source
   * must NOT be: its statement is an aggregate over the shop's whole order history, Postgres has to compute
   * all of it to answer any offset, and paging therefore runs the same aggregation once per page — twenty-five
   * times a tick for an answer that does not change between them.
   */
  hydratesEntities?: boolean
  /**
   * One page of candidates, in a STABLE order.
   *
   * The order has to be total and deterministic, because the worker pages with an offset: without it the
   * same rows can appear on two pages while others appear on none. A page shorter than `limit` means the
   * source is exhausted, which is how the worker knows to stop.
   */
  collect(
    em: EntityManager,
    scope: RunScope,
    params: SweepSourceParams,
    now: Date,
    limit: number,
    offset?: number,
  ): Promise<SweepCandidate[]>
}

/** The population source, which has no query of its own — the audience narrowing is its query. */
export const CUSTOMERS_SOURCE_ID = 'customers'
export const CUSTOMERS_SOURCE_TRIGGER_ID = 'marketing_automation.sweep.customers'

const MS_PER_DAY = 86_400_000

function readAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

export const EXPIRING_QUOTES_SOURCE_ID = 'expiring_quotes'

const expiringQuotes: RowSweepSource = {
  id: EXPIRING_QUOTES_SOURCE_ID,
  labelKey: 'marketing_automation.sweep.expiring_quotes.label',
  requiresModule: 'sales',
  available: true,
  triggerEventId: 'marketing_automation.quote.expiring',
  contextKeys: ['trigger.quoteId', 'trigger.quoteNumber', 'trigger.quoteTotal', 'trigger.daysUntilExpiry'],
  defaultWithinDays: 7,
  // The only source that loads entities: it pages off an indexed date range cheaply, and reading a whole
  // tick's worth in one go would put them all in the identity map together.
  hydratesEntities: true,
  async collect(em, scope, params, now, limit, offset = 0) {
    const withinDays = params.withinDays ?? this.defaultWithinDays
    const horizon = new Date(now.getTime() + withinDays * MS_PER_DAY)
    const quotes = await em.find(
      SalesQuote,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
        validUntil: { $gt: now, $lte: horizon },
        // An accepted or cancelled quote has nothing left to remind anybody about. Both spellings
        // of cancelled appear in the codebase.
        status: { $nin: ['confirmed', 'canceled', 'cancelled'] },
      },
      // `id` breaks ties: two quotes expiring at the same instant must not be able to swap pages.
      { orderBy: { validUntil: 'ASC', id: 'ASC' }, limit, offset },
    )

    const candidates: SweepCandidate[] = []
    for (const quote of quotes) {
      if (!quote.customerEntityId) continue
      const daysUntilExpiry = quote.validUntil
        ? Math.max(0, Math.ceil((new Date(quote.validUntil).getTime() - now.getTime()) / MS_PER_DAY))
        : null
      candidates.push({
        subjectEntityId: quote.customerEntityId,
        trigger: {
          quoteId: quote.id,
          quoteNumber: quote.quoteNumber,
          quoteTotal: readAmount(quote.grandTotalGrossAmount),
          currencyCode: quote.currencyCode,
          validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString() : null,
          daysUntilExpiry,
        },
        // Deliberately NO claim: a quote's expiry is a recurring reminder, and the campaign's own
        // re-entry policy is what an author uses to decide how often to nag.
      })
    }
    return candidates
  },
}

export const FULFILLED_ORDERS_SOURCE_ID = 'fulfilled_orders'
export const FULFILLED_ORDER_TRIGGER_ID = 'marketing_automation.order.fulfilled'

/** How far back the query looks. Beyond this an unsent request is not worth sending. */
const FULFILLED_LOOKBACK_DAYS = 30

/** Statuses that mean the customer has the goods, and can therefore review them. */
const FULFILLED_STATUSES = ['fulfilled', 'delivered', 'complete', 'completed']

const fulfilledOrders: RowSweepSource = {
  id: FULFILLED_ORDERS_SOURCE_ID,
  labelKey: 'marketing_automation.sweep.fulfilled_orders.label',
  requiresModule: 'sales',
  available: true,
  triggerEventId: FULFILLED_ORDER_TRIGGER_ID,
  contextKeys: ['trigger.orderId', 'trigger.orderNumber', 'trigger.orderTotal', 'trigger.daysSinceOrder'],
  defaultWithinDays: 7,
  async collect(em, scope, params, now, limit, offset = 0) {
    const withinDays = params.withinDays ?? this.defaultWithinDays
    // A window, not "everything older than N days": the claim below makes each order single-use, but
    // the QUERY still has to stop growing or every tick would scan the whole order history.
    const notAfter = new Date(now.getTime() - withinDays * MS_PER_DAY)
    const notBefore = new Date(now.getTime() - (withinDays + FULFILLED_LOOKBACK_DAYS) * MS_PER_DAY)

    const orders = await em.find(
      SalesOrder,
      {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
        placedAt: { $gte: notBefore, $lte: notAfter },
        fulfillmentStatus: { $in: FULFILLED_STATUSES },
        status: { $nin: ['canceled', 'cancelled'] },
      },
      { orderBy: { placedAt: 'DESC', id: 'ASC' }, limit, offset },
    )

    const candidates: SweepCandidate[] = []
    for (const order of orders) {
      if (!order.customerEntityId) continue
      const placedAt = order.placedAt ? new Date(order.placedAt) : null
      candidates.push({
        subjectEntityId: order.customerEntityId,
        trigger: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          orderTotal: readAmount(order.grandTotalGrossAmount),
          currencyCode: order.currencyCode,
          placedAt: placedAt ? placedAt.toISOString() : null,
          daysSinceOrder: placedAt ? Math.floor((now.getTime() - placedAt.getTime()) / MS_PER_DAY) : null,
        },
        // Exactly once per order, forever. Asking twice for a review of the same order is the failure
        // mode this whole claim mechanism exists for.
        claimKey: sweepClaimKey([FULFILLED_ORDER_TRIGGER_ID, order.id]),
      })
    }
    return candidates
  },
}

export const BIRTHDAYS_SOURCE_ID = 'birthdays'

/** The custom field this module adds to the person profile — see `ce.ts` for why it is a custom field. */
export const BIRTH_DATE_FIELD_KEY = 'marketing_birth_date'

/**
 * Customers whose birthday falls within the window.
 *
 * **Month and day only.** A stored year may be a guess, a placeholder or absent, and matching it would mean a
 * campaign that fires once ever instead of once a year. The claim key carries the YEAR, which is what makes the
 * campaign annual: the same person is claimed once per calendar year and never twice in one.
 *
 * Reads `custom_field_values` because that is where a custom field lives; the join to the person profile and on
 * to the customer entity is the mapping this module's guidance warns about — the field is stored against the
 * PROFILE id, while a campaign run is about the CUSTOMER.
 */
const birthdays: RowSweepSource = {
  id: BIRTHDAYS_SOURCE_ID,
  labelKey: 'marketing_automation.sweep.birthdays.label',
  available: true,
  triggerEventId: 'marketing_automation.customer.birthday',
  contextKeys: ['trigger.daysUntilBirthday', 'trigger.birthDate'],
  // Zero means "today"; an author who wants a few days' notice raises it.
  defaultWithinDays: 0,
  async collect(em, scope, params, now, limit, offset = 0) {
    const withinDays = Math.max(0, Math.min(params.withinDays ?? 0, 60))

    /**
     * Compared as month-day STRINGS rather than with date arithmetic.
     *
     * A window that crosses new year is the case date arithmetic gets wrong, and a two-element string range
     * handles it by being two ranges — which is also what makes 29 February behave: it simply does not match in
     * a year that has no such day, and a campaign nobody wanted to fire on the 1st of March does not.
     */
    const days: string[] = []
    for (let offset = 0; offset <= withinDays; offset += 1) {
      const at = new Date(now.getTime() + offset * MS_PER_DAY)
      days.push(`${String(at.getUTCMonth() + 1).padStart(2, '0')}-${String(at.getUTCDate()).padStart(2, '0')}`)
    }
    const placeholders = days.map(() => '?').join(', ')

    const rows = await em.getConnection().execute<Array<{ entity_id: string; birth_date: string | null }>>(
      `select p.entity_id as entity_id, v.value_text as birth_date
         from custom_field_values v
         join ${CUSTOMER_PEOPLE} p on p.id::text = v.record_id
         join ${CUSTOMER_ENTITIES} e on e.id = p.entity_id
        where v.field_key = ?
          and v.tenant_id = ? and v.organization_id = ?
          and v.deleted_at is null
          and v.value_text is not null
          and e.deleted_at is null
          and e.kind = 'person'
          and substring(v.value_text from 6 for 5) in (${placeholders})
        order by p.entity_id
        limit ? offset ?`,
      [BIRTH_DATE_FIELD_KEY, scope.tenantId, scope.organizationId, ...days, limit, offset],
    )

    return rows.flatMap((row) => {
      if (!row.entity_id || !row.birth_date) return []
      const monthDay = row.birth_date.slice(5, 10)
      const offset = Math.max(days.indexOf(monthDay), 0)

      /**
       * The year in the claim is the year the BIRTHDAY falls in, not the year the sweep is running in.
       *
       * Those differ for exactly the window this source was careful about elsewhere: a notice period that
       * crosses new year. Swept on 30 December with three days' notice, somebody born on 1 January is claimed
       * under the OLD year; two days later the same birthday is swept again as "today" and claimed under the
       * new one, so the one campaign nobody would forgive sending twice sends twice.
       */
      const occurrence = new Date(now.getTime() + offset * MS_PER_DAY)

      return [{
        subjectEntityId: row.entity_id,
        trigger: {
          birthDate: row.birth_date,
          daysUntilBirthday: offset,
        },
        // The YEAR is in the claim, which is what makes this annual rather than once ever.
        claimKey: sweepClaimKey([BIRTHDAYS_SOURCE_ID, String(occurrence.getUTCFullYear()), row.entity_id]),
      }]
    })
  },
}

export const REORDER_DUE_SOURCE_ID = 'reorder_due'
export const REORDER_DUE_TRIGGER_ID = 'marketing_automation.product.reorder_due'

/**
 * Customers who are due to buy a product again, at their own observed cadence.
 *
 * The one backlog item with no substitute for a consumables shop: the customer WILL buy more coffee, and the only
 * question is whether they buy it here or from whoever reminded them first.
 *
 * **One query for the history, and the arithmetic in `lib/engine/reorder.ts`.** The rules — the median gap rather
 * than the mean, three purchases minimum, a plausible cadence band, the tolerance — are decisions, and decisions
 * belong somewhere they can be argued with and tested. The SQL's only job is to hand over dates.
 *
 * Read from the order line's CATALOGUE SNAPSHOT, like the sku list and for the same reason: a product that was
 * renamed or re-skued must still count as the thing this customer keeps buying.
 */
const reorderDue: RowSweepSource = {
  id: REORDER_DUE_SOURCE_ID,
  labelKey: 'marketing_automation.sweep.reorder_due.label',
  requiresModule: 'sales',
  available: true,
  triggerEventId: REORDER_DUE_TRIGGER_ID,
  contextKeys: [
    'trigger.sku', 'trigger.cycleDays', 'trigger.daysSinceLast', 'trigger.progress', 'trigger.purchases',
  ],
  /**
   * `withinDays` means something different here, and the label says so: it is a percentage of the cycle to
   * remind EARLY, not a window of days. Ten means "a tenth of a cycle before they run out", which for a monthly
   * habit is three days.
   */
  defaultWithinDays: 10,
  async collect(em, scope, params, now, limit, offset = 0) {
    const tolerancePercent = Math.max(0, Math.min(params.withinDays ?? 10, 90))
    const tolerance = tolerancePercent / 100

    /**
     * Candidate PAIRS, not candidate customers: a shop's history of (customer, product) is far larger than its
     * customer list, so the paging the worker does has to page over pairs. Ordered by customer and sku so the
     * order is total, which is what makes an offset safe.
     *
     * The `having` clause does the cheap half of the filtering in the database — a pair with fewer than three
     * purchases can never produce a cadence — so the arithmetic below only ever runs on plausible histories.
     */
    const rows = await em.getConnection().execute<Array<{
      customer_entity_id: string
      sku: string
      purchased_at: Array<Date | string>
    }>>(
      `select o.customer_entity_id,
              coalesce(
                l.catalog_snapshot -> 'product' ->> 'sku',
                l.catalog_snapshot -> 'variant' ->> 'sku'
              ) as sku,
              array_agg(o.placed_at order by o.placed_at desc) as purchased_at
         from ${SALES_ORDER_LINES} l
         join ${SALES_ORDERS} o on o.id = l.order_id
        where ${PLACED_ORDER_LINE_FILTER_SQL_ALIASED}
          and o.customer_entity_id is not null
          and coalesce(
                l.catalog_snapshot -> 'product' ->> 'sku',
                l.catalog_snapshot -> 'variant' ->> 'sku'
              ) is not null
        group by 1, 2
       having count(distinct o.id) >= ?
        order by o.customer_entity_id, 2
        limit ? offset ?`,
      [scope.tenantId, scope.organizationId, MINIMUM_PURCHASES_FOR_CYCLE, limit, offset],
    )

    return rows.flatMap((row) => {
      if (!row.customer_entity_id || !row.sku) return []
      const purchasedAt = (row.purchased_at ?? [])
        .map((value) => (value instanceof Date ? value : new Date(value)))
        .filter((value) => !Number.isNaN(value.getTime()))

      const cycle = reorderCycleFor({ sku: row.sku, purchasedAt }, now, tolerance)
      if (!cycle) return []

      return [{
        subjectEntityId: row.customer_entity_id,
        trigger: {
          sku: cycle.sku,
          cycleDays: cycle.cycleDays,
          daysSinceLast: cycle.daysSinceLast,
          progress: cycle.progress,
          purchases: cycle.purchases,
        },
        /**
         * Once per CYCLE, which is the whole point.
         *
         * A durable claim with no cycle number would remind somebody about their coffee exactly once, ever; no
         * claim at all would remind them every single day once they are overdue. The cycle number makes each
         * repeat its own claim — and the sku is in the key because being due for coffee says nothing about
         * being due for filters.
         */
        claimKey: sweepClaimKey([
          REORDER_DUE_TRIGGER_ID,
          row.customer_entity_id,
          cycle.sku,
          // The SAME tolerance the firing rule used, or an early reminder and an on-time one claim different
          // cycles and the customer is emailed twice.
          String(cycleNumber(cycle, tolerance)),
        ]),
      }]
    })
  },
}

export const ROW_SWEEP_SOURCES: RowSweepSource[] = [expiringQuotes, fulfilledOrders, birthdays, reorderDue]

export function findRowSweepSource(id: string | null | undefined): RowSweepSource | undefined {
  return ROW_SWEEP_SOURCES.find((source) => source.id === id)
}

/** Every source an author may pick, including the population one. */
/**
 * `capabilities` is optional so a caller with no entity manager still gets the catalogue.
 *
 * Passing it narrows `available` by what this installation can actually read. Omitting it answers about the
 * sources themselves, which is what a caller asking "what does this module support" wants.
 */
export function sweepSourceCatalog(capabilities?: MarketingCapabilities): Array<{
  id: string
  labelKey: string
  available: boolean
  blockedReasonKey: string | null
  contextKeys: string[]
  defaultWithinDays: number | null
}> {
  return [
    {
      id: CUSTOMERS_SOURCE_ID,
      labelKey: 'marketing_automation.sweep.customers.label',
      available: true,
      blockedReasonKey: null,
      contextKeys: [],
      defaultWithinDays: null,
    },
    ...ROW_SWEEP_SOURCES.map((source) => {
      // A source the installation cannot read is unavailable for a DIFFERENT reason than an unfinished one, and
      // the reason key is what makes the palette say so rather than just greying the row out.
      const moduleMissing = Boolean(
        capabilities && source.requiresModule && !capabilities[source.requiresModule],
      )
      return {
        id: source.id,
        labelKey: source.labelKey,
        available: source.available && !moduleMissing,
        blockedReasonKey: moduleMissing
          ? `marketing_automation.sweep.blocked.${source.requiresModule}ModuleMissing`
          : source.blockedReasonKey ?? null,
        contextKeys: source.contextKeys,
        defaultWithinDays: source.defaultWithinDays,
      }
    }),
  ]
}

export const SWEEP_SOURCE_IDS = [CUSTOMERS_SOURCE_ID, ...ROW_SWEEP_SOURCES.map((source) => source.id)] as const
