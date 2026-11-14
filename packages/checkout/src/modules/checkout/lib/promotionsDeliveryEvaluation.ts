import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type {
  BuyerContext,
  CodeRef,
  DeliveryDiscountEffect,
  EvaluateItem,
  PromotionsService,
} from '@open-mercato/core/modules/promotions/lib/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { lookupCartLinePeers } from './cartLinesPeer'
import { lookupCartPeerById } from './cartPeer'
import { tryResolve } from './tryResolve'

// Release 5, Step 2.13 (C8/D-R5-17). "At delivery selection ... checkout calls
// `promotionsService.evaluate` with the cart's buyer context plus `deliveryMethodCode`
// and `deliveryCost`" (§5.4). Only the `DELIVERY_DISCOUNT` effect is this Step's concern
// — `LINE_DISCOUNT`/`CART_DISCOUNT`/`ADD_FREE_ITEM` are cart-stage effects `cart.reprice`
// already applied; re-applying them here would double-count. The actual order-line
// mapping of the discount happens at submit (Step 4.1) — this Step only surfaces the
// amount to show the buyer.

const logger = createLogger('checkout')

export type DeliveryPromotionEvaluationContainer = {
  resolve: <T = unknown>(name: string) => T
  register: (registrations: Record<string, unknown>) => unknown
}

export type DeliveryDiscountResult = {
  promotionId: string
  promotionName: string
  deliveryMethodCode: string
  amountNet: string
  amountGross: string
}

function toPromotionEvaluateItem(line: {
  lineId: string
  productId: string
  variantId: string | null
  quantity: string
  unitPriceNet: string | null
  unitPriceGross: string | null
}): EvaluateItem {
  return {
    lineId: line.lineId,
    productId: line.productId,
    variantId: line.variantId,
    quantity: line.quantity,
    unitPriceNet: line.unitPriceNet ?? '0',
    unitPriceGross: line.unitPriceGross ?? '0',
    priceIsPromotional: false,
  }
}

/**
 * Returns `null` — never throws — when `promotions` is absent (C10/D-R5-18 soft peer),
 * the cart cannot be re-read, or no `DELIVERY_DISCOUNT` effect matched. A genuine
 * evaluation failure from `promotionsService.evaluate` itself also degrades to `null`
 * rather than failing delivery-method selection — showing no discount is always safe;
 * silently charging one that was never evaluated is not.
 */
export async function evaluateDeliveryDiscount(
  container: DeliveryPromotionEvaluationContainer,
  em: EntityManager,
  input: {
    sessionId: string
    tenantId: string
    organizationId: string
    cartId: string | null
    currencyCode: string
    deliveryMethodCode: string
    deliveryCost: string
    /**
     * Release 5, Step 4.1 (§7.2 step 2). Closes the gap Step 2.13 flagged in NOTIFY.md: a
     * combined code+delivery rule needs the cart's currently-entered codes re-derived
     * (`lib/cartPeer.ts#lookupCartEnteredCodes`) — defaults to `[]`, preserving Step 2.13's
     * own delivery-selection call (`commands/delivery.ts`) exactly as it behaved before this
     * Step, since that call site has no reason to re-derive codes on every rate re-quote.
     */
    codes?: CodeRef[]
  },
): Promise<DeliveryDiscountResult | null> {
  const promotionsService = tryResolve<PromotionsService>(container, 'promotionsService')
  if (!promotionsService || !input.cartId) return null

  const scope = { tenantId: input.tenantId, organizationId: input.organizationId }
  const cart = await lookupCartPeerById(em, input.cartId, scope)
  if (!cart) return null

  const lines = await lookupCartLinePeers(em, input.cartId, scope)
  const buyer: BuyerContext = {
    customerId: cart.customerId,
    customerIds: cart.customerIds,
    customerGroupIds: cart.customerGroupIds,
  }

  // Mirrors `cart/commands/cart.ts`'s own precedent: `promotionsService.evaluate()`
  // resolves tenant/organization scope from whatever is registered under the `auth` DI
  // token on ITS OWN container — register it here, on this per-request container, before
  // resolving the service (`promotions/lib/promotions-service.ts`'s
  // `resolvePromotionsServiceScope`).
  container.register({ auth: asValue({ tenantId: input.tenantId, orgId: input.organizationId }) })

  try {
    const result = await promotionsService.evaluate({
      items: lines.map(toPromotionEvaluateItem),
      currency: input.currencyCode,
      evaluatedAt: new Date().toISOString(),
      buyer,
      customerOrderCount: null,
      cartWeight: null,
      codes: input.codes ?? [],
      deliveryMethodCode: input.deliveryMethodCode,
      deliveryCost: input.deliveryCost,
    })

    for (const applied of result.appliedPromotions) {
      const deliveryEffect = applied.effects.find(
        (effect): effect is DeliveryDiscountEffect => effect.type === 'DELIVERY_DISCOUNT',
      )
      if (deliveryEffect) {
        return {
          promotionId: applied.promotionId,
          promotionName: applied.promotionName,
          deliveryMethodCode: deliveryEffect.deliveryMethodCode,
          amountNet: deliveryEffect.amountNet,
          amountGross: deliveryEffect.amountGross,
        }
      }
    }
    return null
  } catch (err) {
    logger.warn('[internal] delivery promotion evaluation failed, showing no discount', {
      err,
      sessionId: input.sessionId,
    })
    return null
  }
}
