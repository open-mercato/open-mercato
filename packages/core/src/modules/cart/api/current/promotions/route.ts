import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

import { applyPromotionCommand } from '../../../commands/promotions'
import type { CartPromotionsApplyInput, CartPromotionsCommandResult } from '../../../commands/promotions'
import { cartPromotionApplyRequestSchema } from '../../../data/validators'
import {
  CART_RESOURCE_KIND,
  buildCommandContext,
  mapRouteErrorToResponse,
  notFoundCartResponse,
  readCartToken,
  resolveCurrentCart,
  resolveRouteContextOrError,
} from '../../../lib/currentCartRoute'
import { buildCartResponseEnvelope } from '../../../lib/cartView'
import type { CartViewWarning } from '../../../lib/cartView'
import { resolveCartWarningMessage } from '../../../lib/warningMessages'
import { enforceCartRateLimit } from '../../../lib/rateLimit'

// Step 7.2 — `POST /current/promotions` -> `cart.promotions.apply` (§10 "Apply code").
//
// No `Idempotency-Key` wiring here, unlike `current/lines/route.ts` and `.../bulk/route.ts`.
// Judgment call, mirroring `current/lines/[lineId]/route.ts`'s own documented precedent for
// `PATCH`/`DELETE`: idempotency is wired only for a mutation whose REPLAY would otherwise
// produce a different end state (`cart.create`/`.lines.add`/`.bulkAdd`, where a merge-by-
// quantity re-add would double the quantity). `cart.promotions.apply` is already idempotent
// in effect by construction — `promotionsService.reserveCode()` is idempotent per
// `(code, cart)` (§Code Lifecycle), and the command's own placeholder-row creation dedupes
// by `(cartId, codeId, promotionId)` before persisting — so a replay with no key is a safe
// no-op that just re-confirms the same applied code, not a second application.
export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(request: Request) {
  try {
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

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    let body: z.infer<typeof cartPromotionApplyRequestSchema>
    try {
      body = cartPromotionApplyRequestSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        userId: resolved.routeContext.customerUserId ?? 'anonymous',
        tenantId: resolved.routeContext.tenantId,
        organizationId: resolved.routeContext.organizationId,
        userFeatures: [],
      },
      input: { resourceKind: CART_RESOURCE_KIND, resourceId: cart.id, operation: 'create', mutationPayload: body },
    })
    if (!guarded.ok) return guarded.response

    enforceCommandOptimisticLock({
      resourceKind: CART_RESOURCE_KIND,
      resourceId: cart.id,
      current: cart.updatedAt,
      request,
    })

    const commandInput: CartPromotionsApplyInput = {
      cartId: cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
      routeContext: resolved.routeContext,
      codeString: body.codeString,
    }
    const { result } = await commandBus.execute<CartPromotionsApplyInput, CartPromotionsCommandResult>(
      applyPromotionCommand.id,
      { input: commandInput, ctx },
    )

    await guarded.runAfterSuccess()

    const { translate } = await resolveTranslations()
    const warnings: CartViewWarning[] | undefined = result.warnings?.map((warning) =>
      warning.code === 'product_unavailable'
        ? { code: warning.code, message: resolveCartWarningMessage('product_unavailable', translate) }
        : { code: warning.code, message: resolveCartWarningMessage('promotion_no_longer_valid', translate) },
    )
    // `cart.promotions.apply` always dispatches `cart.reprice` internally, which always
    // flushes the cart row inside its own transaction — `updatedAt` bumps every time,
    // regardless of whether the resolved effects numerically changed.
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
  summary: 'Apply a promotion code to the current cart',
  methods: {
    POST: {
      summary: 'Apply a promotion code',
      description:
        'Reserves the code (§Code Lifecycle) and triggers an internal re-price so the code is evaluated immediately. Carries the standard optimistic-lock header (§8.1).',
      requestBody: { contentType: 'application/json', schema: cartPromotionApplyRequestSchema },
      responses: [{ status: 200, description: 'Code applied; the cart envelope reflects its effects (if any)' }],
      errors: [
        { status: 400, description: 'Invalid request body' },
        { status: 404, description: 'No `X-Cart-Token` header, or the token does not resolve a cart' },
        { status: 409, description: 'Optimistic-lock conflict, or `code_reservation_unavailable` (§15a)' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
