import type { EntityManager } from '@mikro-orm/postgresql'
import { SalesOrder, SalesQuote } from '@open-mercato/core/modules/sales/data/entities'
import type { RunScope } from './runs.js'

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
export const SCORE_CHANGED_TRIGGER_ID = 'marketing_automation.customer.score_changed'

const scoreChanged: TriggerCatalogEntry = {
  eventId: SCORE_CHANGED_TRIGGER_ID,
  labelKey: 'marketing_automation.trigger.marketing_automation.customer.score_changed.label',
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

export const TRIGGER_CATALOG: TriggerCatalogEntry[] = [
  personCreated,
  tagAssigned,
  orderCreated,
  scoreChanged,
  expiringQuote,
  fulfilledOrder,
  abandonedCart,
]

export function findTrigger(eventId: string): TriggerCatalogEntry | undefined {
  return TRIGGER_CATALOG.find((entry) => entry.eventId === eventId)
}

/** Event ids a campaign may be authored against. */
export function availableEventTriggers(): TriggerCatalogEntry[] {
  return TRIGGER_CATALOG.filter((entry) => entry.available)
}
