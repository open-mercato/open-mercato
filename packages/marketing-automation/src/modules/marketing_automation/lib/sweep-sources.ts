import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import { sweepClaimKey } from './occurrence.js'
import type { RunScope } from './runs.js'

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
  /** The synthetic trigger id runs from this source are recorded under. */
  triggerEventId: string
  /** Paths the audience builder can offer for this source. */
  contextKeys: string[]
  /** Default for `withinDays` when the author did not set one. */
  defaultWithinDays: number
  collect(
    em: EntityManager,
    scope: RunScope,
    params: SweepSourceParams,
    now: Date,
    limit: number,
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
  available: true,
  triggerEventId: 'marketing_automation.quote.expiring',
  contextKeys: ['trigger.quoteId', 'trigger.quoteNumber', 'trigger.quoteTotal', 'trigger.daysUntilExpiry'],
  defaultWithinDays: 7,
  async collect(em, scope, params, now, limit) {
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
      { orderBy: { validUntil: 'ASC' }, limit },
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
  available: true,
  triggerEventId: FULFILLED_ORDER_TRIGGER_ID,
  contextKeys: ['trigger.orderId', 'trigger.orderNumber', 'trigger.orderTotal', 'trigger.daysSinceOrder'],
  defaultWithinDays: 7,
  async collect(em, scope, params, now, limit) {
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
      { orderBy: { placedAt: 'DESC' }, limit },
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

export const ROW_SWEEP_SOURCES: RowSweepSource[] = [expiringQuotes, fulfilledOrders]

export function findRowSweepSource(id: string | null | undefined): RowSweepSource | undefined {
  return ROW_SWEEP_SOURCES.find((source) => source.id === id)
}

/** Every source an author may pick, including the population one. */
export function sweepSourceCatalog(): Array<{
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
    ...ROW_SWEEP_SOURCES.map((source) => ({
      id: source.id,
      labelKey: source.labelKey,
      available: source.available,
      blockedReasonKey: source.blockedReasonKey ?? null,
      contextKeys: source.contextKeys,
      defaultWithinDays: source.defaultWithinDays,
    })),
  ]
}

export const SWEEP_SOURCE_IDS = [CUSTOMERS_SOURCE_ID, ...ROW_SWEEP_SOURCES.map((source) => source.id)] as const
