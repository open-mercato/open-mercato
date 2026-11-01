import { NextResponse } from 'next/server'
// Step 4.5 (§6.2, D-R5-21). `assisted_selling` and `customer_accounts` are both
// `packages/core` modules — the SAME static import `cart/lib/currentCartRoute.ts` (Step 2.9)
// and `checkout/lib/currentSessionRoute.ts` already use for this exact helper, now a fourth
// call site of one established precedent rather than a new one.
import { getCustomerAuthFromRequest } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'

import { resolveCartService } from './cartAccess'
import type { AssistedSellingResolvedBasket } from './cartAccess'

// §6.2's own credential rule, reproduced here as a literal rather than imported — the same
// "duck-type the DI surface, don't import `cart/lib`" discipline `cartAccess.ts` and
// `lib/organizationScope.ts` already document for this module's cross-module reads.
export const ASSISTED_SELLING_CART_TOKEN_HEADER = 'X-Cart-Token'

export function readAssistedSellingCartToken(request: Request): string | null {
  const value = request.headers.get(ASSISTED_SELLING_CART_TOKEN_HEADER)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function notFoundThreadResponse(): NextResponse {
  return NextResponse.json({ error: '[internal] assisted selling thread not found' }, { status: 404 })
}

export type AssistedSellingBuyerBasket = AssistedSellingResolvedBasket

/**
 * §6.2/D-R5-13/D-R5-21, the THIRD application of this exact mechanism in this run (`cart`'s
 * `/current/*`, `checkout`'s `/sessions/current/*`, now this module's `/thread`): resolves the
 * `X-Cart-Token` header to its basket (via `cartService.resolveBasketByToken`, DI, never a
 * direct `cart.Cart` import), then — when the basket carries a `customerUserId` — requires the
 * matching customer session, answering the SAME outcome (`null`, collapsed by the caller into
 * the unknown-cart `404`) for an unknown token, a cross-tenant token, and an identified
 * basket's token presented without (or with a mismatched) customer session. A guest basket
 * (`customerUserId` null) is unaffected — the token alone resolves it, exactly as `cart`'s own
 * `/current/*` and `/proposals/*` routes behave.
 */
export async function resolveIdentifiedBuyerBasket(
  container: { resolve: <T = unknown>(name: string) => T },
  request: Request,
  token: string,
): Promise<AssistedSellingBuyerBasket | null> {
  const cartService = resolveCartService(container)
  const basket = await cartService.resolveBasketByToken({ token })
  if (!basket) return null
  if (basket.customerUserId) {
    const auth = await getCustomerAuthFromRequest(request)
    if (!auth || auth.sub !== basket.customerUserId) return null
  }
  return basket
}

const logger = createLogger('assisted_selling').child({ component: 'api' })

/** Mirrors `cart/lib/currentCartRoute.ts#mapRouteErrorToResponse` — the same CrudHttpError /
 * command-interceptor-rejection / unexpected-500 mapping, reimplemented locally per this
 * module's own "don't import `cart/lib`" convention rather than imported across the boundary. */
export async function mapAssistedSellingBuyerRouteError(error: unknown): Promise<NextResponse> {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  const interceptorRejection = getCommandInterceptorHttpRejection(error)
  if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  logger.error('assisted_selling buyer route failed', { err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'assisted_selling', code: 'assisted_selling.buyer_route_failed' })
  const { translate } = await resolveTranslations()
  return NextResponse.json({ error: translate('assisted_selling.errors.unexpected', 'Unexpected error') }, { status: 500 })
}
