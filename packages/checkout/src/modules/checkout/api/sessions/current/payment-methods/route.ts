import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { listCheckoutPaymentMethods } from '../../../../lib/paymentMethods'
import { lookupCartPeerById } from '../../../../lib/cartPeer'
import { readCheckoutSessionToken, resolveCurrentSession } from '../../../../lib/currentSessionRoute'
import {
  buildCheckoutSessionScopedRateLimitKey,
  checkoutSessionOtherGetRateLimitConfig,
  enforceCheckoutRateLimit,
} from '../../../../lib/rateLimiter'
import { hashCheckoutSessionToken } from '../../../../lib/sessionToken'
import { CheckoutLink } from '../../../../data/entities'
import { handleCheckoutRouteError } from '../../../helpers'
import { checkoutTag } from '../../../openapi'

// Release 5, Step 2.13 (B.3 gateway, §5.5, §9's route table: `GET /sessions/current/
// payment-methods`). `on_account`/`request_quote` eligibility (§5.5's own B.5 half) is
// out of this Step's scope (needs `customer_groups` terms not yet wired into checkout);
// their expected absence is documented in `lib/paymentMethods.ts`.
export const metadata = {
  path: '/checkout/sessions/current/payment-methods',
  GET: { requireAuth: false },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
    const token = readCheckoutSessionToken(req)
    if (!token) return NextResponse.json({ error: '[internal] checkout session not found' }, { status: 404 })

    const tokenHash = hashCheckoutSessionToken(token)
    // §13: "Other GET under /sessions/current | 120/min per session | fail-open".
    const limited = await enforceCheckoutRateLimit({
      req,
      container,
      config: checkoutSessionOtherGetRateLimitConfig,
      namespace: 'checkout-session-other-get',
      errorMessage: 'Too many checkout session requests. Please try again later.',
      posture: 'fail-open',
      keyOverride: buildCheckoutSessionScopedRateLimitKey('checkout-session-other-get', tokenHash),
    })
    if (limited) return limited

    const resolved = await resolveCurrentSession(em, req, token)
    if (!resolved.ok) return resolved.response
    const { session, scope } = resolved

    let linkGatewayProviderKey: string | null = null
    if (session.linkId) {
      const link = await em.findOne(CheckoutLink, { id: session.linkId, ...scope } as any)
      linkGatewayProviderKey = link?.gatewayProviderKey ?? null
    }

    // Release 5, Step 5.1 (§5.5's B.5 half): the cart's own buyer identity gates
    // `on_account`/`request_quote` — a session with no cart attached yet (or whose cart
    // peer cannot be read) has no identity to resolve terms against, same as a guest.
    const cartPeer = session.cartId ? await lookupCartPeerById(em, session.cartId, scope) : null
    const buyer = cartPeer ? { customerId: cartPeer.customerId, customerIds: cartPeer.customerIds } : null

    const methods = await listCheckoutPaymentMethods(container, scope, {
      currencyCode: session.currencyCode,
      linkGatewayProviderKey,
      buyer,
    })

    return NextResponse.json({ methods })
  } catch (error) {
    return handleCheckoutRouteError(error)
  }
}

export const openApi = {
  tags: [checkoutTag],
  headers: z.object({ 'X-Checkout-Session-Token': z.string().optional() }),
}
