import type { EntityManager } from '@mikro-orm/postgresql'
import { reportError } from '@open-mercato/telemetry'
import { SalesOrder } from '@open-mercato/core/modules/sales/data/entities'
import { emitMarketingAutomationEvent } from '../events.js'
import { convertPendingReferral } from '../lib/referrals.js'
import { logger } from '../lib/subscriber-forward.js'
import type { SubscriberContext } from '../lib/subscriber-forward.js'

/**
 * Turns a pending referral into a converted one when the referred customer buys.
 *
 * A second subscriber on `sales.order.created` rather than logic inside the first: forwarding an event to
 * campaigns and converting a referral are unrelated jobs with different failure modes, and a referral write
 * that threw would otherwise stop every campaign from seeing the order.
 *
 * Runs on EVERY order in the installation, so the first thing it does is the cheapest question it can ask —
 * does this customer have a pending claim — and the overwhelmingly common answer is no.
 */
export const metadata = {
  event: 'sales.order.created',
  persistent: true,
  id: 'marketing_automation:referral-conversion',
}

export default async function handle(
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
     * The order is re-read because the event carries only its id.
     *
     * Documented in this module's guidance and true here too: `sales.order.created` says almost nothing about
     * the order, so the customer and the total have to be fetched.
     */
    const order = await em.findOne(SalesOrder, { id: orderId, ...scope, deletedAt: null })
    const referredEntityId = order?.customerEntityId ?? null
    if (!referredEntityId) return

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
      orderId,
      error: error instanceof Error ? error.message : String(error),
    })
    reportError(error, {
      module: 'marketing_automation',
      code: 'marketing_automation.referral_conversion_failed',
      attributes: { orderId },
    })
  }
}
