import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { FilterQuery } from '@mikro-orm/core'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { CrudHttpError, isCrudHttpError, badRequest } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { enforceCommandOptimisticLock, readOptimisticLockExpected } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { StoreContextService } from '@open-mercato/core/modules/ecommerce/lib/storeContextService'
import { Cart } from '../../../../data/entities'
import { cartAdminRepriceRequestSchema } from '../../../../data/validators'
import { repriceCartCommand } from '../../../../commands/cart'
import type { CartRepriceInput, CartRepriceResult } from '../../../../commands/cart'
import type { ResolvedCartRouteContext } from '../../../../lib/routeContext'
import { assertCartNotLocked } from '../../../../lib/lockGuard'
import { buildCartResponseEnvelope } from '../../../../lib/cartView'
import type { CartViewWarning } from '../../../../lib/cartView'
import { resolveCartWarningMessage } from '../../../../lib/warningMessages'
import { CART_RESOURCE_KIND } from '../../../../lib/currentCartRoute'
import { organizationIdsFromCartScope } from '../../../../lib/adminCartScope'

// Step 2.10 (K6, §10.2 rev 10) — `POST /api/cart/carts/:id/reprice`. Trigger 7: an admin-
// forced whole-cart re-price for a `kind = 'basket'` cart in `active` OR `abandoned`
// status (`commands/cart.ts`'s `cart.reprice` status guard was relaxed in this same Step
// to allow the latter — it never reactivates the cart or touches `last_activity_at`, so
// §10.2's "not buyer activity" guarantee holds by construction, not by a special case
// here). Identity is refreshed through `ecommerce`'s `storeContextService.resolveForBuyer`
// from the cart's OWN stored identity (soft `tryResolve` — `ecommerce` stays a soft peer of
// `cart`, same as every other call site in this module), so a storefront cart also gets the
// §6a.2 whole-cart re-visibility pass against its buyer's CURRENT scope (D-R5-22). A
// non-storefront cart (`storeId` null) skips the identity refresh and the visibility pass
// entirely — there is no scope to refresh against.

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['cart.carts.manage'] },
}

const CART_ADMIN_REPRICE_RESOURCE_KIND = CART_RESOURCE_KIND

const paramsSchema = z.object({ id: z.string().uuid() })

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

const logger = createLogger('cart').child({ component: 'admin-cart-reprice' })

function tryResolveStoreContextService(container: { resolve: <T = unknown>(name: string) => T }): StoreContextService | null {
  try {
    return container.resolve<StoreContextService>('storeContextService') ?? null
  } catch {
    return null
  }
}

export async function POST(req: Request, context: RouteContext) {
  const { translate } = await resolveTranslations()
  const cartNotFound = () =>
    new CrudHttpError(404, { error: translate('cart.admin.errors.cartNotFound', 'Cart not found.') })
  try {
    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) throw cartNotFound()

    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(req)
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('cart.admin.errors.unauthorized', 'Unauthorized') })
    }
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, { error: translate('cart.admin.errors.tenantRequired', 'Tenant context is required.') })
    }

    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req }).catch(() => null)
    const organizationIds = organizationIdsFromCartScope(scope, scope?.selectedId ?? auth.orgId ?? null)
    if (Array.isArray(organizationIds) && organizationIds.length === 0) throw cartNotFound()

    const em = (container.resolve('em') as EntityManager).fork()
    const where: Record<string, unknown> = { id: params.data.id, tenantId, kind: 'basket' as const }
    if (organizationIds) where.organizationId = { $in: organizationIds }
    const cart = await findOneWithDecryption(em, Cart, where as FilterQuery<Cart>, {}, { tenantId })
    if (!cart) throw cartNotFound()

    assertCartNotLocked(cart)
    if (cart.status !== 'active' && cart.status !== 'abandoned') {
      throw new CrudHttpError(409, {
        error: translate('cart.admin.errors.cartNotActive', 'The cart is not active or abandoned.'),
        code: 'cart_not_active',
      })
    }

    const rawBody = (await readJsonSafe<Record<string, unknown>>(req, {})) ?? {}
    const parsedBody = cartAdminRepriceRequestSchema.safeParse(rawBody)
    if (!parsedBody.success) throw badRequest(translate('cart.admin.errors.invalidInput', 'Invalid input'))

    // §10.2: "The optimistic-lock header is required for this route: a missing header is
    // `400`" — stricter than `enforceCommandOptimisticLock`'s own default fail-open
    // behavior (silently a no-op with no header), so the presence check runs first.
    if (!readOptimisticLockExpected(req)) {
      throw badRequest(
        translate('cart.admin.errors.optimisticLockRequired', 'The expected version header is required for this action.'),
      )
    }
    enforceCommandOptimisticLock({
      resourceKind: CART_ADMIN_REPRICE_RESOURCE_KIND,
      resourceId: cart.id,
      current: cart.updatedAt,
      request: req,
    })

    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId: auth.sub, tenantId, organizationId: cart.organizationId },
      input: { resourceKind: CART_ADMIN_REPRICE_RESOURCE_KIND, resourceId: cart.id, operation: 'update', mutationPayload: parsedBody.data },
    })
    if (!guarded.ok) return guarded.response

    // (D-R5-22, §10.2) Refresh the buyer's identity from the cart's OWN stored identity —
    // never from the staff caller's own request — before dispatching the reprice.
    // `ecommerce` absent, or no store context service registered, is the documented
    // fallback: the reprice still runs, just without an identity/visibility refresh.
    const storeContextService = tryResolveStoreContextService(container)
    const buyerRefresh = storeContextService
      ? await storeContextService.resolveForBuyer({
          tenantId: cart.tenantId,
          organizationId: cart.organizationId,
          storeId: cart.storeId ?? null,
          customerUserId: cart.customerUserId ?? null,
          customerId: cart.customerId ?? null,
        })
      : null

    const routeContext: ResolvedCartRouteContext | undefined =
      cart.storeId && buyerRefresh && buyerRefresh.assortmentScope !== undefined
        ? {
            tenantId: cart.tenantId,
            organizationId: cart.organizationId,
            storeId: cart.storeId,
            channel: 'storefront',
            assortmentScope: buyerRefresh.assortmentScope,
            buyerDigest: buyerRefresh.buyerDigest,
            customerId: buyerRefresh.customerId,
            customerIds: buyerRefresh.customerIds,
            customerGroupIds: buyerRefresh.customerGroupIds,
            customerUserId: buyerRefresh.customerUserId,
            currencyCode: buyerRefresh.currencyCode ?? cart.currencyCode,
            locale: cart.locale,
            taxMode: buyerRefresh.taxMode ?? cart.taxMode,
            salesChannelId: cart.salesChannelId ?? null,
            priceKindId: buyerRefresh.priceKindId,
          }
        : undefined

    const repriceInput: CartRepriceInput = {
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      trigger: 'admin_reprice',
      routeContext,
      ...(buyerRefresh
        ? {
            buyerDigest: buyerRefresh.buyerDigest,
            customerId: buyerRefresh.customerId,
            customerIds: buyerRefresh.customerIds,
            customerUserId: buyerRefresh.customerUserId,
            customerGroupIds: buyerRefresh.customerGroupIds,
            priceKindId: buyerRefresh.priceKindId,
          }
        : {}),
    }

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: cart.organizationId,
      organizationIds,
      request: req,
    }
    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<CartRepriceInput, CartRepriceResult>(repriceCartCommand.id, {
      input: repriceInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    // Same `CartPromotionWarning` -> `CartViewWarning` mapping `current/promotions/route.ts`
    // already uses for the identical union (§6a.3/D-R4-8: an admin-forced re-price can
    // reject a gift line or lapse a code reservation exactly like a buyer-triggered one).
    const warnings: CartViewWarning[] | undefined = result.warnings?.map((warning) =>
      warning.code === 'product_unavailable'
        ? { code: warning.code, message: resolveCartWarningMessage('product_unavailable', translate) }
        : { code: warning.code, message: resolveCartWarningMessage('promotion_no_longer_valid', translate) },
    )

    const responseBody = await buildCartResponseEnvelope({
      container,
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      priceChanges: result.priceChanges,
      versionBumpReason: 'repricing',
      warnings,
    })

    return NextResponse.json(responseBody)
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    logger.error('admin cart reprice failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'cart', code: 'cart.admin_reprice_failed' })
    return NextResponse.json(
      { error: translate('cart.admin.errors.repriceFailed', 'Failed to re-price the cart.') },
      { status: 500 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Admin forced re-price',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Force a whole-cart re-price (trigger 7)',
      description:
        'Admin-forced re-price for an active or abandoned basket (§10.2). Requires the optimistic-lock header; refreshes the buyer’s identity from the cart’s own stored identity before re-pricing. Never reactivates an abandoned basket.',
      requestBody: { contentType: 'application/json', schema: cartAdminRepriceRequestSchema },
      responses: [{ status: 200, description: 'The re-priced cart envelope' }],
      errors: [
        { status: 400, description: 'The optimistic-lock header is missing' },
        { status: 401, description: 'Unauthorized' },
        { status: 404, description: 'Unknown cart, a different organization, or a proposal cart' },
        { status: 409, description: 'Optimistic-lock conflict, or the cart is not active/abandoned' },
        { status: 423, description: 'The cart is locked for checkout' },
      ],
    },
  },
}
