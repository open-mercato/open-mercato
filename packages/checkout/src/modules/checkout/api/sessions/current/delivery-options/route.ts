import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveDestinationAddress, hashAddressForCache, hashCartLinesForCache } from '../../../../lib/deliveryAddress'
import { getOrComputeDeliveryOptions } from '../../../../lib/deliveryRateCache'
import { computeDeliveryOptions } from '../../../../lib/deliveryRateQuote'
import { lookupCartLinePeers } from '../../../../lib/cartLinesPeer'
import {
  buildCheckoutSessionScopedRateLimitKey,
  checkoutDeliveryOptionsRateLimitConfig,
  enforceCheckoutRateLimit,
} from '../../../../lib/rateLimiter'
import { readCheckoutSessionToken, resolveCurrentSession } from '../../../../lib/currentSessionRoute'
import { hashCheckoutSessionToken } from '../../../../lib/sessionToken'
import { handleCheckoutRouteError } from '../../../helpers'
import { checkoutTag } from '../../../openapi'

// Release 5, Step 2.13 (B.3, §5.3, §9's route table, §13: "30/min per session,
// fail-closed"). Anonymous, token-bound exactly like `GET /sessions/current` (§9.0);
// binding (D-R5-33) and cross-tenant scope (C21) are both enforced inside
// `resolveCurrentSession` before any read.
export const metadata = {
  path: '/checkout/sessions/current/delivery-options',
  GET: { requireAuth: false },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const token = readCheckoutSessionToken(req)
    if (!token) return NextResponse.json({ error: '[internal] checkout session not found' }, { status: 404 })

    const tokenHash = hashCheckoutSessionToken(token)
    const perSessionLimited = await enforceCheckoutRateLimit({
      req,
      container,
      config: checkoutDeliveryOptionsRateLimitConfig,
      namespace: 'checkout-delivery-options',
      errorMessage: 'Too many delivery rate requests. Please try again later.',
      posture: 'fail-closed',
      keyOverride: buildCheckoutSessionScopedRateLimitKey('checkout-delivery-options', tokenHash),
    })
    if (perSessionLimited) return perSessionLimited

    const resolved = await resolveCurrentSession(em, req, token)
    if (!resolved.ok) return resolved.response
    const { session, scope } = resolved

    const destination = resolveDestinationAddress(session.shippingAddress)
    if (!destination) {
      return NextResponse.json(
        { error: '[internal] a shipping address is required to quote delivery rates', code: 'delivery_unavailable' },
        { status: 422 },
      )
    }

    const lines = session.cartId ? await lookupCartLinePeers(em, session.cartId, scope) : []
    const addressHash = hashAddressForCache(destination)
    const cartHash = hashCartLinesForCache(lines)

    const options = await getOrComputeDeliveryOptions(
      container as unknown as { resolve: <T = unknown>(name: string) => T },
      { tenantId: scope.tenantId, organizationId: scope.organizationId, sessionId: session.id },
      addressHash,
      cartHash,
      () =>
        computeDeliveryOptions(
          container as unknown as { resolve: <T = unknown>(name: string) => T; hasRegistration?: (name: string) => boolean },
          em,
          {
            id: session.id,
            tenantId: session.tenantId,
            organizationId: session.organizationId,
            cartId: session.cartId ?? null,
            storeId: session.storeId ?? null,
            linkId: session.linkId ?? null,
            channel: session.channel,
            currencyCode: session.currencyCode,
          },
          destination,
        ),
    )

    return NextResponse.json({ options })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
  headers: z.object({ 'X-Checkout-Session-Token': z.string().optional() }),
}
