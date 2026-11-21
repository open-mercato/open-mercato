import type { EntityManager } from '@mikro-orm/postgresql'
import { reportError } from '@open-mercato/telemetry'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { hasSales } from './capabilities.js'
import { emitMarketingAutomationEvent } from '../events.js'
import { convertPendingReferral } from './referrals.js'
import { logger } from './subscriber-forward.js'
import type { SubscriberContext } from './subscriber-forward.js'

/**
 * Converts a pending referral when an order event says the referred customer's order now counts.
 *
 * Three events reach this. `sales.order.created` covers an order that is already placed the moment it
 * exists — the common storefront shape, where `placedAt` arrives in the same request that creates the row.
 * `sales.order.confirmed` covers an order created first (a draft, a quote turned into an order, a
 * submission awaiting review) and placed or confirmed afterwards: `emitOrderLifecycleEventsForTransition`
 * emits it unconditionally on an actual status transition, on both create (an order already confirmed when
 * it is made) and update (one confirmed later).
 *
 * Neither covers an order created already `confirmed` but not yet `placedAt` — a backoffice order awaiting
 * fulfilment, say — that later has `placedAt` set by itself, with `status` unchanged:
 * `emitOrderLifecycleEventsForTransition`'s own transition guard (`previousStatus === nextStatus`) means
 * `.confirmed` does not fire a second time, and `.created` only ever fires once. `sales.order.updated`
 * closes that gap — the update command now passes `events: orderCrudEvents` to `emitCrudSideEffects`
 * (`packages/core/src/modules/sales/commands/documents.ts`), so every order update reaches the bus, not
 * only ones that changed `status`.
 *
 * The eligibility check stays the SAME question regardless of which event asked it — the module's own
 * definition of a placed order (`lib/order-filter.ts`'s `PLACED_ORDER_FILTER_SQL`, read directly off the
 * row) — so a confirmed order with no `placedAt` still converts nothing, same as an unplaced `.created`
 * one. `convertPendingReferral`'s conditional UPDATE is what makes receiving both events for the same order
 * harmless: whichever one asks second finds nothing left to convert.
 */
export async function convertReferralFromOrderEvent(
  eventId: string,
  payload: Record<string, unknown>,
  ctx: SubscriberContext,
): Promise<void> {
  const tenantId = typeof payload.tenantId === 'string' ? payload.tenantId : ''
  const organizationId = typeof payload.organizationId === 'string' ? payload.organizationId : ''
  const orderId = typeof payload.id === 'string' ? payload.id : ''
  if (!tenantId || !organizationId || !orderId) return

  const scope = { tenantId, organizationId }

  try {
    const em = ctx.resolve<EntityManager>('em')

    /**
     * Both callers are subscribers to a `sales.order.*` event, which cannot fire on an installation without
     * `sales` — but the probe is cheap, and it is what makes THIS file self-evidently safe without asking a
     * reader to trust that only those two subscribers will ever call it.
     */
    if (!(await hasSales(em))) return

    /**
     * The order is re-read because the event carries only its id.
     *
     * Documented in this module's guidance and true here too: a sales order event says almost nothing
     * about the order, so the customer and the total have to be fetched.
     */
    const order = await em.findOne(SalesOrder, { id: orderId, ...scope, deletedAt: null })
    const referredEntityId = order?.customerEntityId ?? null
    if (!referredEntityId) return

    /**
     * A cancelled order converts nothing, and nor does one that is not yet placed.
     *
     * The conversion is the whole payout: it flips the claim and emits the event a reward step listens to.
     * Taking any order event that is not actually placed yet would let somebody place a draft, have the
     * referral convert, and cancel it — the reward is already irreversible by then, because the conditional
     * UPDATE is what stops a second one and it has already fired. The same two conditions every other order
     * read in this module uses (`lib/order-filter.ts`): both spellings of cancelled are excluded, and
     * `placedAt` excludes carts (or drafts) that were never submitted.
     */
    const cancelled = order?.status === 'canceled' || order?.status === 'cancelled'
    if (cancelled || !order?.placedAt) return

    const converted = await convertPendingReferral(em, scope, {
      referredEntityId,
      orderId,
      orderTotal: order?.grandTotalGrossAmount != null ? String(order.grandTotalGrossAmount) : null,
      now: new Date(),
    })
    if (!converted) return

    /**
     * The subject is the REFERRER.
     *
     * This is the subject flip the whole feature turns on: the person to thank, reward or tag is the one who
     * shared the code, and they are not the customer this order belongs to. The referred customer travels as
     * trigger context so an audience can still reason about them.
     */
    await emitMarketingAutomationEvent('marketing_automation.referral.converted', {
      entityId: converted.referrerEntityId,
      tenantId,
      organizationId,
      code: converted.code,
      referredEntityId: converted.referredEntityId,
      orderId: converted.orderId,
      orderTotal: converted.orderTotal,
    }, { persistent: true })

    logger.info('marketing referral converted', {
      referrerEntityId: converted.referrerEntityId,
      orderId: converted.orderId,
    })
  } catch (error) {
    logger.error('[internal] marketing referral conversion failed', {
      eventId,
      orderId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.referral_conversion_failed',
      attributes: { eventId, orderId },
    })
  }
}
