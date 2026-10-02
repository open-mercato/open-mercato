import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import type { RunScope } from './runs.js'
import {
  CUSTOMER_DEAL_PERSON_LINKS,
  CUSTOMER_ENTITIES,
  SALES_INVOICES,
  SALES_ORDERS,
  SALES_PAYMENTS,
} from './external/tables.js'

/**
 * What a trigger hands the engine: who the run is about, and the scalars an audience
 * expression can compare against under `trigger.*`.
 */
export type TriggerContext = {
  subjectEntityId: string | null
  trigger: Record<string, unknown>
}

export type TriggerCatalogEntry = {
  /** A platform event id, used verbatim — there is no separate trigger vocabulary to keep in sync. */
  eventId: string
  labelKey: string
  available: boolean
  blockedReasonKey?: string
  /** Paths this trigger contributes, so the audience builder can offer them. */
  contextKeys: string[]
  build(payload: Record<string, unknown>, em: EntityManager, scope: RunScope): Promise<TriggerContext>
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Sales money columns are `numeric` mapped to string, so an audience needs them parsed. */
function readAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const parsed = Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : null
}

const personCreated: TriggerCatalogEntry = {
  eventId: 'customers.person.created',
  labelKey: 'marketing_automation.trigger.customers.person.created.label',
  available: true,
  contextKeys: [],
  async build(payload) {
    // The payload's `id` is the PERSON PROFILE id, not the customer. Reading it would key every
    // run and every tag assignment on the wrong row, so `entityId` is the only correct source.
    return { subjectEntityId: readString(payload.entityId), trigger: {} }
  },
}

const tagAssigned: TriggerCatalogEntry = {
  eventId: 'customers.tag.assigned',
  labelKey: 'marketing_automation.trigger.customers.tag.assigned.label',
  available: true,
  contextKeys: ['trigger.tagId'],
  async build(payload) {
    return {
      subjectEntityId: readString(payload.entityId),
      trigger: { tagId: readString(payload.tagId) },
    }
  },
}

const orderCreated: TriggerCatalogEntry = {
  eventId: 'sales.order.created',
  labelKey: 'marketing_automation.trigger.sales.order.created.label',
  available: true,
  contextKeys: ['trigger.orderId', 'trigger.orderNumber', 'trigger.orderTotal', 'trigger.currencyCode'],
  async build(payload, em, scope) {
    const orderId = readString(payload.id)
    if (!orderId) return { subjectEntityId: null, trigger: {} }

    // The order event carries only { id, organizationId, tenantId, userId } — no customer and
    // no total — so anything an audience wants to compare has to be loaded here.
    const order = await em.findOne(SalesOrder, {
      id: orderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!order) return { subjectEntityId: null, trigger: { orderId } }

    return {
      subjectEntityId: order.customerEntityId ?? null,
      trigger: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTotal: readAmount(order.grandTotalGrossAmount),
        currencyCode: order.currencyCode,
        status: order.status ?? null,
      },
    }
  },
}

/**
 * Not an event: a scheduled sweep synthesises this per expiring quote.
 *
 * Kept in the catalog so the audience builder can offer its paths, and marked unavailable as an
 * event trigger so it cannot be picked from the event palette.
 */
export const EXPIRING_QUOTE_TRIGGER_ID = 'marketing_automation.quote.expiring'

const expiringQuote: TriggerCatalogEntry = {
  eventId: EXPIRING_QUOTE_TRIGGER_ID,
  labelKey: 'marketing_automation.trigger.sales.quote.expiring.label',
  available: false,
  contextKeys: ['trigger.quoteId', 'trigger.quoteNumber', 'trigger.quoteTotal', 'trigger.daysUntilExpiry'],
  async build(payload, em, scope) {
    const quoteId = readString(payload.quoteId)
    if (!quoteId) return { subjectEntityId: null, trigger: {} }
    const quote = await em.findOne(SalesQuote, {
      id: quoteId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!quote) return { subjectEntityId: null, trigger: { quoteId } }
    return {
      subjectEntityId: quote.customerEntityId ?? null,
      trigger: {
        quoteId: quote.id,
        quoteNumber: quote.quoteNumber,
        quoteTotal: readAmount(quote.grandTotalGrossAmount),
        currencyCode: quote.currencyCode,
        validUntil: quote.validUntil ? new Date(quote.validUntil).toISOString() : null,
        daysUntilExpiry: payload.daysUntilExpiry ?? null,
      },
    }
  },
}

/**
 * The module's own score change, which a campaign may react to.
 *
 * Deliberately NOT a "threshold crossed" trigger with a configured threshold. The payload carries the
 * previous total alongside the new one, so an audience expresses the crossing itself —
 * `trigger.previousPoints < 100 AND score.points >= 100` — which fires once, needs no configuration,
 * and lets one installation have as many thresholds as it likes.
 */
export const SCORE_CHANGED_TRIGGER_ID = 'marketing_automation.score.changed'

const scoreChanged: TriggerCatalogEntry = {
  eventId: SCORE_CHANGED_TRIGGER_ID,
  labelKey: 'marketing_automation.trigger.marketing_automation.score.changed.label',
  available: true,
  contextKeys: ['trigger.points', 'trigger.previousPoints', 'trigger.delta'],
  async build(payload) {
    return {
      subjectEntityId: readString(payload.entityId),
      trigger: {
        points: typeof payload.points === 'number' ? payload.points : null,
        previousPoints: typeof payload.previousPoints === 'number' ? payload.previousPoints : null,
        delta: typeof payload.delta === 'number' ? payload.delta : null,
      },
    }
  },
}

/**
 * A fulfilled order, synthesised by the review-request sweep.
 *
 * Unavailable as an EVENT trigger — there is no fulfilment event to subscribe to — but in the catalog
 * so the audience builder offers its paths, exactly like the expiring-quote sweep.
 */
const fulfilledOrder: TriggerCatalogEntry = {
  eventId: 'marketing_automation.order.fulfilled',
  labelKey: 'marketing_automation.trigger.marketing_automation.order.fulfilled.label',
  available: false,
  contextKeys: ['trigger.orderId', 'trigger.orderNumber', 'trigger.orderTotal', 'trigger.daysSinceOrder'],
  async build(payload) {
    return { subjectEntityId: readString(payload.entityId), trigger: {} }
  },
}

/**
 * A product due to be bought again, synthesised by the reorder sweep.
 *
 * In the catalog and unavailable as an EVENT trigger, like the other sweep-synthesised ones: there is nothing to
 * subscribe to, and the entry exists so the audience builder offers the paths a reorder campaign needs. An
 * author writes copy against `trigger.sku` and `trigger.cycleDays` — "your coffee usually lasts you about a
 * month" is a sentence only this context makes possible.
 */
const reorderDue: TriggerCatalogEntry = {
  eventId: 'marketing_automation.product.reorder_due',
  labelKey: 'marketing_automation.trigger.marketing_automation.product.reorder_due.label',
  available: false,
  contextKeys: [
    'trigger.sku', 'trigger.cycleDays', 'trigger.daysSinceLast', 'trigger.progress', 'trigger.purchases',
  ],
  async build(payload) {
    return { subjectEntityId: readString(payload.entityId), trigger: {} }
  },
}

/**
 * Abandoned cart, recorded as deliberately unavailable.
 *
 * There is no cart entity in the platform — `sales_*` holds submitted documents and
 * `checkout_*` holds payment links — so the trigger cannot be implemented yet. The entry exists
 * so the palette can show it greyed out with the reason instead of leaving somebody to wonder
 * why the most famous marketing trigger is missing.
 */
const abandonedCart: TriggerCatalogEntry = {
  eventId: 'storefront.cart.abandoned',
  labelKey: 'marketing_automation.trigger.storefront.cart.abandoned.label',
  available: false,
  blockedReasonKey: 'marketing_automation.trigger.unavailable.cart',
  contextKeys: ['trigger.cartId', 'trigger.cartTotal', 'trigger.cartItemCount'],
  async build(payload) {
    return { subjectEntityId: readString(payload.entityId), trigger: {} }
  },
}

/**
 * Something outside the platform asked for this campaign.
 *
 * The subject is resolved by the endpoint, not here: identifying a customer from an email address needs a
 * decrypting scan, which belongs at the edge where it can be bounded and reported, not in a trigger
 * builder that runs inside the dispatcher.
 *
 * The posted fields are exposed under `trigger.*`, so an audience can compare them and copy can print
 * them — which is the whole reason for accepting a body at all.
 */
const inboundReceived: TriggerCatalogEntry = {
  eventId: 'marketing_automation.inbound.received',
  labelKey: 'marketing_automation.trigger.marketing_automation.inbound.received.label',
  available: true,
  contextKeys: ['trigger.hookName'],
  async build(payload) {
    const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {}
    return {
      subjectEntityId: readString(payload.entityId),
      // `hookName` last so a posted field of that name cannot shadow which hook this was.
      trigger: { ...data, hookName: readString(payload.hookName) },
    }
  },
}

/**
 * Somebody who arrived on this customer's referral code has bought something.
 *
 * The subject is the REFERRER — the person to thank or reward — which is why this exists as its own event
 * rather than as an audience rule over `sales.order.created`: that event is about the buyer, and no audience
 * expression can turn one person's order into a different person's run.
 */
const referralConverted: TriggerCatalogEntry = {
  eventId: 'marketing_automation.referral.converted',
  labelKey: 'marketing_automation.trigger.marketing_automation.referral.converted.label',
  available: true,
  contextKeys: ['trigger.code', 'trigger.referredEntityId', 'trigger.orderTotal'],
  async build(payload) {
    return {
      subjectEntityId: readString(payload.entityId),
      trigger: {
        code: readString(payload.code),
        referredEntityId: readString(payload.referredEntityId),
        orderId: readString(payload.orderId),
        // Parsed, because sales money is a numeric mapped to string and an audience has to compare it.
        orderTotal: readAmount(payload.orderTotal),
      },
    }
  },
}

/**
 * A product this customer asked to be told about got cheaper.
 *
 * The highest-intent signal in the module: the subject told you the product and the condition. The drop
 * percentage travels as context so an audience can require a real discount — "at least 20% off" is a
 * different campaign from "any drop".
 */
const priceDropped: TriggerCatalogEntry = {
  eventId: 'marketing_automation.product.price_dropped',
  labelKey: 'marketing_automation.trigger.marketing_automation.product.price_dropped.label',
  available: true,
  contextKeys: ['trigger.sku', 'trigger.dropPercent', 'trigger.currentPrice', 'trigger.previousPrice'],
  async build(payload) {
    return {
      subjectEntityId: readString(payload.entityId),
      trigger: {
        sku: readString(payload.sku),
        currencyCode: readString(payload.currencyCode),
        previousPrice: readAmount(payload.previousPrice),
        currentPrice: readAmount(payload.currentPrice),
        dropPercent: readAmount(payload.dropPercent),
      },
    }
  },
}

/**
 * A tag being taken away, which is the mirror of `customers.tag.assigned`.
 *
 * Worth having for the campaign nobody thinks of until they need it: a customer losing the `vip` tag, or the
 * `at-risk` tag being cleared because they came back. The payload is identical to the assigned counterpart, so
 * this reads it the same way.
 */
const tagRemoved: TriggerCatalogEntry = {
  eventId: 'customers.tag.removed',
  labelKey: 'marketing_automation.trigger.customers.tag.removed.label',
  available: true,
  contextKeys: ['trigger.tagId'],
  async build(payload) {
    return {
      subjectEntityId: readString(payload.entityId),
      trigger: { tagId: readString(payload.tagId) },
    }
  },
}

/**
 * An order reaching a confirmed status, as distinct from being created.
 *
 * The two are genuinely different moments and the useful one is usually this: an order is created the instant
 * somebody presses buy, while confirmation is the shop accepting it. A thank-you or a cross-sell hung off
 * creation goes out for orders that are then rejected.
 *
 * The event's own payload is richer than the CRUD one — it carries the order number and both statuses — but
 * still no customer and no total, so the order is loaded for those.
 */
const orderConfirmed: TriggerCatalogEntry = {
  eventId: 'sales.order.confirmed',
  labelKey: 'marketing_automation.trigger.sales.order.confirmed.label',
  available: true,
  contextKeys: ['trigger.orderId', 'trigger.orderNumber', 'trigger.orderTotal', 'trigger.currencyCode', 'trigger.previousStatus'],
  async build(payload, em, scope) {
    const orderId = readString(payload.orderId) ?? readString(payload.id)
    if (!orderId) return { subjectEntityId: null, trigger: {} }

    const order = await em.findOne(SalesOrder, {
      id: orderId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    })
    if (!order) return { subjectEntityId: null, trigger: { orderId } }

    return {
      subjectEntityId: order.customerEntityId ?? null,
      trigger: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderTotal: readAmount(order.grandTotalGrossAmount),
        currencyCode: order.currencyCode,
        status: order.status ?? null,
        // Carried because "confirmed from draft" and "confirmed from on-hold" are different stories.
        previousStatus: readString(payload.previousStatus),
      },
    }
  },
}

/**
 * An invoice being created, which is the closest thing the platform has to one being issued.
 *
 * There is no `sales.invoice.issued` event and no issue command — checked, not assumed — so this is what a
 * payment-reminder or a document-delivery campaign has to hang off. The outstanding amount travels in the
 * context because it is what such a campaign is actually about.
 *
 * An invoice reaches a customer THROUGH its order: the invoice itself carries no customer column. An invoice
 * with no order therefore produces no subject, and no run — which is correct rather than unfortunate, since
 * there is nobody for the campaign to be about.
 */
const invoiceCreated: TriggerCatalogEntry = {
  eventId: 'sales.invoice.created',
  labelKey: 'marketing_automation.trigger.sales.invoice.created.label',
  available: true,
  contextKeys: [
    'trigger.invoiceId', 'trigger.invoiceNumber', 'trigger.invoiceTotal',
    'trigger.outstanding', 'trigger.currencyCode', 'trigger.orderId',
  ],
  async build(payload, em, scope) {
    const invoiceId = readString(payload.id)
    if (!invoiceId) return { subjectEntityId: null, trigger: {} }

    const rows = await em.getConnection().execute<Array<{
      invoice_number: string | null
      grand_total_gross_amount: string | null
      outstanding_amount: string | null
      currency_code: string | null
      status: string | null
      order_id: string | null
      customer_entity_id: string | null
    }>>(
      `select i.invoice_number, i.grand_total_gross_amount, i.outstanding_amount, i.currency_code, i.status,
              i.order_id, o.customer_entity_id
         from ${SALES_INVOICES} i
         left join ${SALES_ORDERS} o on o.id = i.order_id and o.deleted_at is null
        where i.id = ? and i.tenant_id = ? and i.organization_id = ? and i.deleted_at is null`,
      [invoiceId, scope.tenantId, scope.organizationId],
    )
    const row = rows[0]
    if (!row) return { subjectEntityId: null, trigger: { invoiceId } }

    return {
      subjectEntityId: readString(row.customer_entity_id),
      trigger: {
        invoiceId,
        invoiceNumber: readString(row.invoice_number),
        invoiceTotal: readAmount(row.grand_total_gross_amount),
        outstanding: readAmount(row.outstanding_amount),
        currencyCode: readString(row.currency_code),
        status: readString(row.status),
        orderId: readString(row.order_id),
      },
    }
  },
}

/**
 * Money actually arriving, from the gateway rather than from the ledger.
 *
 * `payment_gateways.payment.captured` is the honest "paid" signal: `sales.payment.created` fires when a
 * payment ROW is written, which happens for a pending authorisation too, so a thank-you hung off it thanks
 * people who have not paid. This one is emitted when a provider reports the capture, and it carries the
 * payment id, which is what leads to the customer.
 *
 * Also offered below as `sales.payment.created` for installations recording payments by hand, where no gateway
 * ever reports anything — that trigger carries the status so an author can filter it themselves.
 */
const paymentCaptured: TriggerCatalogEntry = {
  eventId: 'payment_gateways.payment.captured',
  labelKey: 'marketing_automation.trigger.payment.captured.label',
  available: true,
  contextKeys: ['trigger.paymentId', 'trigger.amount', 'trigger.currencyCode', 'trigger.providerKey', 'trigger.orderId'],
  async build(payload, em, scope) {
    const paymentId = readString(payload.paymentId)
    if (!paymentId) return { subjectEntityId: null, trigger: {} }
    const hydrated = await hydratePayment(paymentId, em, scope)
    return {
      subjectEntityId: hydrated.subjectEntityId,
      trigger: { ...hydrated.trigger, providerKey: readString(payload.providerKey) },
    }
  },
}

/** A payment row being written, whatever its status. See `paymentCaptured` for why both exist. */
const paymentCreated: TriggerCatalogEntry = {
  eventId: 'sales.payment.created',
  labelKey: 'marketing_automation.trigger.sales.payment.created.label',
  available: true,
  contextKeys: ['trigger.paymentId', 'trigger.amount', 'trigger.currencyCode', 'trigger.status', 'trigger.orderId'],
  async build(payload, em, scope) {
    const paymentId = readString(payload.id)
    if (!paymentId) return { subjectEntityId: null, trigger: {} }
    return hydratePayment(paymentId, em, scope)
  },
}

/**
 * A payment's customer and amounts, reached through its order.
 *
 * Shared by both payment triggers so the two cannot drift: a payment carries no customer column, and the order
 * is the only route from one to the other.
 */
async function hydratePayment(
  paymentId: string,
  em: EntityManager,
  scope: RunScope,
): Promise<TriggerContext> {
  const rows = await em.getConnection().execute<Array<{
    amount: string | null
    captured_amount: string | null
    currency_code: string | null
    status: string | null
    order_id: string | null
    customer_entity_id: string | null
  }>>(
    `select p.amount, p.captured_amount, p.currency_code, p.status, p.order_id, o.customer_entity_id
       from ${SALES_PAYMENTS} p
       left join ${SALES_ORDERS} o on o.id = p.order_id and o.deleted_at is null
      where p.id = ? and p.tenant_id = ? and p.organization_id = ? and p.deleted_at is null`,
    [paymentId, scope.tenantId, scope.organizationId],
  )
  const row = rows[0]
  if (!row) return { subjectEntityId: null, trigger: { paymentId } }

  return {
    subjectEntityId: readString(row.customer_entity_id),
    trigger: {
      paymentId,
      amount: readAmount(row.amount),
      capturedAmount: readAmount(row.captured_amount),
      currencyCode: readString(row.currency_code),
      status: readString(row.status),
      orderId: readString(row.order_id),
    },
  }
}

/**
 * A deal closing, won or lost.
 *
 * **The subject is the deal's PRIMARY contact, and nothing else will do.** A deal links to several people, so
 * "who is this run about" has no obvious answer — and the two tempting answers are both wrong: the first link
 * by row order makes the campaign depend on insertion order, and fanning out to everybody mails the whole
 * buying committee a message written for one person. `is_primary` is the field the CRM already uses to say who
 * the deal is with, so a deal without one produces no run, which is a state an operator can see and fix.
 *
 * The event's payload carries the deal's title and value already; only the contact needs looking up.
 */
function dealClosure(won: boolean): TriggerCatalogEntry {
  const outcome = won ? 'won' : 'lost'
  return {
    eventId: `customers.deal.${outcome}`,
    labelKey: `marketing_automation.trigger.customers.deal.${outcome}.label`,
    available: true,
    contextKeys: ['trigger.dealId', 'trigger.dealTitle', 'trigger.dealValue', 'trigger.currencyCode', 'trigger.outcome'],
    async build(payload, em, scope) {
      const dealId = readString(payload.id)
      if (!dealId) return { subjectEntityId: null, trigger: {} }

      const rows = await em.getConnection().execute<Array<{ person_entity_id: string | null }>>(
        `select l.person_entity_id
           from ${CUSTOMER_DEAL_PERSON_LINKS} l
           join ${CUSTOMER_ENTITIES} e on e.id = l.person_entity_id
          where l.deal_id = ?
            and l.is_primary = true
            and e.tenant_id = ? and e.organization_id = ?
            and e.deleted_at is null
            and e.kind = 'person'
          limit 1`,
        [dealId, scope.tenantId, scope.organizationId],
      )

      return {
        subjectEntityId: readString(rows[0]?.person_entity_id),
        trigger: {
          dealId,
          dealTitle: readString(payload.title),
          dealValue: readAmount(payload.valueAmount),
          currencyCode: readString(payload.valueCurrency),
          outcome,
        },
      }
    },
  }
}

const dealWon = dealClosure(true)
const dealLost = dealClosure(false)

export const TRIGGER_CATALOG: TriggerCatalogEntry[] = [
  personCreated,
  tagAssigned,
  orderCreated,
  scoreChanged,
  expiringQuote,
  fulfilledOrder,
  inboundReceived,
  referralConverted,
  priceDropped,
  abandonedCart,
  tagRemoved,
  orderConfirmed,
  invoiceCreated,
  paymentCaptured,
  paymentCreated,
  dealWon,
  dealLost,
  reorderDue,
]

export function findTrigger(eventId: string): TriggerCatalogEntry | undefined {
  return TRIGGER_CATALOG.find((entry) => entry.eventId === eventId)
}

/** Event ids a campaign may be authored against. */
export function availableEventTriggers(): TriggerCatalogEntry[] {
  return TRIGGER_CATALOG.filter((entry) => entry.available)
}
