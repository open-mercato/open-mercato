import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

import { removePromotionCommand } from '../../../../commands/promotions'
import type { CartPromotionsCommandResult, CartPromotionsRemoveInput } from '../../../../commands/promotions'
import {
  CART_RESOURCE_KIND,
  buildCommandContext,
  mapRouteErrorToResponse,
  notFoundCartResponse,
  readCartToken,
  resolveCurrentCart,
  resolveRouteContextOrError,
} from '../../../../lib/currentCartRoute'
import { buildCartResponseEnvelope } from '../../../../lib/cartView'
import type { CartViewWarning } from '../../../../lib/cartView'
import { resolveCartWarningMessage } from '../../../../lib/warningMessages'
import { enforceCartRateLimit } from '../../../../lib/rateLimit'

// Step 7.2 — `DELETE /current/promotions/[id]` -> `cart.promotions.remove` (§10 "Remove").
//
// `[id]` is read as the applied PROMOTION's id, not the `CartPromotionApplication` row's
// own id or the code's id — the spec never names this path param's meaning anywhere else
// (checked `.ai/specs/2026-08-14-cart-module.md` and `lib/cartView.ts`'s unwired
// `promotions: never[]` field). `CartPromotionApplication` is keyed by `(cartId,
// promotionId[, cartLineId])`, and a buyer-facing "applied promotions" list naturally shows
// promotions, not internal application-row ids — documented judgment call (Step 7.2),
// mirrored in `commands/promotions.ts`'s own `CartPromotionsRemoveInput.promotionId` doc.
//
// No `Idempotency-Key` wiring, same precedent `current/lines/[lineId]/route.ts` already
// documents for its own `DELETE`: `cart.promotions.remove` is already idempotent in effect
// — removing an already-removed (or never-applied) promotion 404s the same way removing an
// already-removed line does.
export const metadata = {
  DELETE: { requireAuth: false },
}

type RouteParams = { params: Promise<{ id: string }> | { id: string } }

const promotionIdParamsSchema = z.object({ id: z.string().uuid() })

async function resolvePromotionId(context: RouteParams): Promise<string> {
  const raw = await context.params
  const parsed = promotionIdParamsSchema.safeParse(raw)
  if (!parsed.success) {
    throw badRequest('[internal] invalid promotion id path param')
  }
  return parsed.data.id
}

export async function DELETE(request: Request, context: RouteParams) {
  try {
    const promotionId = await resolvePromotionId(context)
    const container = await createRequestContainer()
    const token = readCartToken(request)

    const limited = await enforceCartRateLimit(container, request, 'mutate', token)
    if (limited) return limited

    const resolved = await resolveRouteContextOrError(request, container)
    if (!resolved.ok) return resolved.response
    if (!token) return notFoundCartResponse()

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx = buildCommandContext(container, request, resolved.routeContext)
    const resolvedCart = await resolveCurrentCart(commandBus, ctx, resolved.routeContext, token)
    if (!resolvedCart) return notFoundCartResponse()
    const { cart } = resolvedCart

    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        userId: resolved.routeContext.customerUserId ?? 'anonymous',
        tenantId: resolved.routeContext.tenantId,
        organizationId: resolved.routeContext.organizationId,
        userFeatures: [],
      },
      input: { resourceKind: CART_RESOURCE_KIND, resourceId: cart.id, operation: 'delete' },
    })
    if (!guarded.ok) return guarded.response

    enforceCommandOptimisticLock({
      resourceKind: CART_RESOURCE_KIND,
      resourceId: cart.id,
      current: cart.updatedAt,
      request,
    })

    const commandInput: CartPromotionsRemoveInput = {
      cartId: cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
      routeContext: resolved.routeContext,
      promotionId,
    }
    const { result } = await commandBus.execute<CartPromotionsRemoveInput, CartPromotionsCommandResult>(
      removePromotionCommand.id,
      { input: commandInput, ctx },
    )

    await guarded.runAfterSuccess()

    const { translate } = await resolveTranslations()
    const warnings: CartViewWarning[] | undefined = result.warnings?.map((warning) =>
      warning.code === 'product_unavailable'
        ? { code: warning.code, message: resolveCartWarningMessage('product_unavailable', translate) }
        : { code: warning.code, message: resolveCartWarningMessage('promotion_no_longer_valid', translate) },
    )
    const responseBody = await buildCartResponseEnvelope({
      container,
      cartId: cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
      priceChanges: result.priceChanges,
      versionBumpReason: 'repricing',
      warnings,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Remove an applied promotion from the current cart',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    DELETE: {
      summary: 'Remove an applied promotion',
      description:
        'Releases the code reservation (if any), deletes the application row(s) and any gift lines the promotion produced, then triggers an internal re-price.',
      responses: [{ status: 200, description: 'Promotion removed' }],
      errors: [
        { status: 404, description: 'No `X-Cart-Token` header, the token does not resolve a cart, or the promotion is not applied to this cart' },
        { status: 409, description: 'Optimistic-lock conflict' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
