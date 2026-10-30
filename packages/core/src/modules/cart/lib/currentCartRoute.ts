import { NextResponse } from 'next/server'
import type { AppContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

import { getCartCommand } from '../commands/cart'
import type { CartGetByTokenInput, CartSummary } from '../commands/cart'
import type { CartPriceChange } from './reprice'
import { isCartStoreContextUnavailableError, resolveCartRouteContext } from './routeContext'
import type { ResolveCartRouteContextOptions, ResolvedCartRouteContext } from './routeContext'

// Step 4.7 — shared plumbing for the four `/api/cart/current/*` route files
// (`current/route.ts`, `current/lines/route.ts`, `current/lines/[lineId]/route.ts`,
// `current/lines/bulk/route.ts`). Kept here rather than duplicated per file because
// every one of them needs the identical: resolve-the-store-context-at-the-edge
// step (§6a.1a), the `X-Cart-Token` header read (§8.3/§10, never a path segment or
// query string), the token→cart lookup via `cart.get`, and the same CrudHttpError /
// interceptor-rejection → HTTP mapping.

/**
 * §8.1's literal resourceKind for every cart mutation's optimistic-lock AND
 * mutation-guard call — the lock helper's own `resourceKind` input, paired with
 * `resourceId: cart.id`, `current: cart.updatedAt` and `request: ctx.request`. Used
 * for line-level mutations too — a `CartLine` has its own `updated_at`, but the lock
 * token this module's concurrency contract tracks is the CART aggregate's, per
 * §8.1's own text (which names `cart.cart` for every mutating command, not a
 * per-sub-resource kind).
 */
export const CART_RESOURCE_KIND = 'cart.cart'

/** §8.3/§10: the ONLY place a cart token travels — never a path segment, never a query string. */
export const CART_TOKEN_HEADER = 'X-Cart-Token'

export function readCartToken(request: Request): string | null {
  const value = request.headers.get(CART_TOKEN_HEADER)
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export type ResolvedContextResult =
  | { ok: true; routeContext: ResolvedCartRouteContext }
  | { ok: false; response: NextResponse }

/**
 * Wraps `resolveCartRouteContext` (Step 4.3) and maps
 * `CartStoreContextUnavailableError` to a `503` — per that error's own doc comment
 * ("the route layer must map this to a 503") and this step's explicit brief.
 *
 * (Step 7.3) Accepts an optional `opts`, forwarded verbatim to
 * `resolveCartRouteContext` — D-R4-22's "lock and merge routes resolve the buyer context
 * fresh (`{ fresh: true }`)". Every pre-existing caller omits it and is unaffected
 * (`undefined` forwards to the same default `resolveCartRouteContext` already had).
 */
export async function resolveRouteContextOrError(
  request: Request,
  container: AppContainer,
  opts?: ResolveCartRouteContextOptions,
): Promise<ResolvedContextResult> {
  try {
    const routeContext = await resolveCartRouteContext(request, container, opts)
    return { ok: true, routeContext }
  } catch (error) {
    if (isCartStoreContextUnavailableError(error)) {
      const { translate } = await resolveTranslations()
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: translate(
              'cart.errors.store_context_unavailable',
              'Cart is unavailable for this store right now',
            ),
            code: 'cart_store_context_unavailable',
          },
          { status: 503 },
        ),
      }
    }
    throw error
  }
}

/**
 * Builds the `CommandRuntimeContext` every `/current/*` command call shares.
 * `auth` stays `null` — the storefront caller is anonymous, or a buyer with no
 * staff identity at all (`ResolvedCartRouteContext.customerUserId` is where an
 * identified buyer's identity already lives); this mirrors `cart.create`'s own
 * documented "Pattern C" assumption (`commands/cart.ts`). Tenant/organization scope
 * for the commands' own `ensureTenantScope`/`ensureOrganizationScope` defense-in-depth
 * checks comes from `selectedOrganizationId`, which the resolved store context
 * already pins — not from an (absent) staff `auth` scope.
 */
export function buildCommandContext(
  container: AppContainer,
  request: Request,
  routeContext: ResolvedCartRouteContext,
): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: routeContext.organizationId,
    organizationIds: null,
    request,
  }
}

/**
 * (Step 5.1) `resolveCurrentCart`'s result. `priceChanges` is always an array (possibly
 * empty); `versionBumpReason` is set exactly when §5.2 triggers 2-4 fired and `cart.get`
 * ran `cart.reprice` internally for this call — see `commands/cart.ts`'s `getCartCommand`.
 */
export type ResolvedCurrentCart = {
  cart: CartSummary
  priceChanges: CartPriceChange[]
  versionBumpReason?: 'repricing'
}

/**
 * Resolves the "current" cart addressed by the presented `X-Cart-Token`, scoped to
 * the resolved store's tenant/organization (§8.3: `kind = 'basket'` only, via
 * `cart.get`). Returns `null` when the token does not resolve — a wrong token, a
 * cross-tenant token and a real `kind = 'proposal'` cart all collapse to the same
 * `null` here, matching `cart.get`'s own no-enumeration-oracle contract.
 *
 * (Step 5.1) Always supplies `freshContext: routeContext` — every one of the four
 * `/current/*` routes that calls this helper has already resolved a `StoreContext` at the
 * route edge, so `cart.get` always has a fresh buyer context to compare against, not only
 * on the literal `GET /current` route: "per-request BuyerContext digest comparison (also
 * on GET)" (PLAN.md Step 5.1) is implemented once, here, for every caller.
 */
export async function resolveCurrentCart(
  commandBus: CommandBus,
  ctx: CommandRuntimeContext,
  routeContext: ResolvedCartRouteContext,
  token: string,
): Promise<ResolvedCurrentCart | null> {
  const input: CartGetByTokenInput = {
    tenantId: routeContext.tenantId,
    organizationId: routeContext.organizationId,
    token,
    freshContext: routeContext,
  }
  const { result } = await commandBus.execute<CartGetByTokenInput, Awaited<ReturnType<typeof getCartCommand.execute>>>(
    getCartCommand.id,
    { input, ctx },
  )
  if (!result.found) return null
  return {
    cart: result.cart,
    priceChanges: result.priceChanges ?? [],
    versionBumpReason: result.versionBumpReason,
  }
}

export function notFoundCartResponse(): NextResponse {
  return NextResponse.json({ error: '[internal] cart not found' }, { status: 404 })
}

const logger = createLogger('cart').child({ component: 'api' })

/**
 * Standard catch-block mapping for every `/current/*` route: a thrown
 * `CrudHttpError` (badRequest/notFound/conflict from a command, or the standardized
 * optimistic-lock/idempotency-mismatch 409/422) echoes its own status/body; a
 * command-interceptor rejection (none exist for `cart` yet, but the mapping is the
 * same one `promotions/api/[id]/tree/route.ts` uses for an identical custom
 * command-backed route) echoes its own status/body; anything else is an
 * unexpected 500, logged and reported.
 */
export async function mapRouteErrorToResponse(error: unknown): Promise<NextResponse> {
  if (isCrudHttpError(error)) return NextResponse.json(error.body, { status: error.status })
  const interceptorRejection = getCommandInterceptorHttpRejection(error)
  if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  logger.error('cart api route failed', { err: error })
  getTelemetryRuntime()?.reportError(error, { module: 'cart', code: 'cart.api_route_failed' })
  const { translate } = await resolveTranslations()
  return NextResponse.json({ error: translate('cart.errors.unexpected', 'Unexpected error') }, { status: 500 })
}
