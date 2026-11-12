import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { badRequest } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

import { removeLineCommand, updateLineCommand } from '../../../../commands/lines'
import type {
  CartLinesRemoveInput,
  CartLinesRemoveResult,
  CartLinesUpdateInput,
  CartLinesUpdateOutcome,
} from '../../../../commands/lines'
import { cartLineUpdateRequestSchema } from '../../../../data/validators'
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

// Step 4.7 — `PATCH /current/lines/[lineId]` → `cart.lines.update`; `DELETE
// /current/lines/[lineId]` → `cart.lines.remove`. No idempotency wiring here: the
// task names `create`/`add`/`bulkAdd` as the "plausibly retried by a flaky client"
// set — a quantity `update` re-applies to the same end state on replay, and
// `remove` is already idempotent in effect (removing an already-removed line
// 404s, same as removing one that never existed).
export const metadata = {
  PATCH: { requireAuth: false },
  DELETE: { requireAuth: false },
}

type RouteParams = { params: Promise<{ lineId: string }> | { lineId: string } }

const lineIdParamsSchema = z.object({ lineId: z.string().uuid() })

async function resolveLineId(context: RouteParams): Promise<string> {
  const raw = await context.params
  const parsed = lineIdParamsSchema.safeParse(raw)
  if (!parsed.success) {
    throw badRequest('[internal] invalid lineId path param')
  }
  return parsed.data.lineId
}

/** Mirrors `lines/route.ts`'s `statusForAddOutcome` mapping for the `update` outcome union (§15a). */
function statusForUpdateOutcome(outcome: CartLinesUpdateOutcome): number {
  if (outcome.status === 'updated') return 200
  if (outcome.reason === 'product_unavailable') return 200
  return 422
}

/** Step 5.2 — mirrors `lines/route.ts`'s identical `isWarningLevelOutcome` judgment call. */
function isWarningLevelUpdateOutcome(outcome: CartLinesUpdateOutcome): boolean {
  return outcome.status !== 'rejected' || outcome.reason === 'product_unavailable'
}

export async function PATCH(request: Request, context: RouteParams) {
  try {
    const lineId = await resolveLineId(context)
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
    const { cart, priceChanges: contextPriceChanges, versionBumpReason: contextVersionBumpReason } = resolvedCart

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    let body: z.infer<typeof cartLineUpdateRequestSchema>
    try {
      body = cartLineUpdateRequestSchema.parse(rawBody)
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
      input: { resourceKind: CART_RESOURCE_KIND, resourceId: cart.id, operation: 'update', mutationPayload: body },
    })
    if (!guarded.ok) return guarded.response

    enforceCommandOptimisticLock({
      resourceKind: CART_RESOURCE_KIND,
      resourceId: cart.id,
      current: cart.updatedAt,
      request,
    })

    const commandInput: CartLinesUpdateInput = {
      routeContext: resolved.routeContext,
      cartId: cart.id,
      lineId,
      quantity: body.quantity,
    }
    const { result } = await commandBus.execute<CartLinesUpdateInput, CartLinesUpdateOutcome>(updateLineCommand.id, {
      input: commandInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    // Step 5.1 — two independent repricing sources can contribute here: the
    // `resolveCurrentCart`-embedded §5.2 trigger 2-4 check (above) and `cart.lines.update`'s
    // own §5.2 trigger 1 (a tier-crossing re-price, only on `status: 'updated'`). Both carry
    // the identical `versionBumpReason: 'repricing'` signal, so either one sets it.
    const mutationPriceChanges = result.status === 'updated' ? result.priceChanges : []
    const priceChanges = [...contextPriceChanges, ...mutationPriceChanges]
    const versionBumpReason = contextVersionBumpReason ?? (mutationPriceChanges.length > 0 ? 'repricing' : undefined)

    let responseBody: Record<string, unknown>
    if (isWarningLevelUpdateOutcome(result)) {
      const { translate } = await resolveTranslations()
      const warnings: CartViewWarning[] =
        result.status === 'updated'
          ? result.warnings.map((code) => ({
              code,
              lineId: result.line.id,
              message: resolveCartWarningMessage('quantity_capped', translate),
            }))
          : [{ code: 'product_unavailable', lineId, message: resolveCartWarningMessage('line_unavailable', translate) }]
      responseBody = await buildCartResponseEnvelope({
        container,
        cartId: cart.id,
        tenantId: resolved.routeContext.tenantId,
        organizationId: resolved.routeContext.organizationId,
        priceChanges,
        versionBumpReason,
        warnings,
      })
    } else {
      responseBody = { outcome: result }
      if (priceChanges.length > 0) responseBody.priceChanges = priceChanges
      if (versionBumpReason) responseBody.versionBumpReason = versionBumpReason
    }

    return NextResponse.json(responseBody, { status: statusForUpdateOutcome(result) })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export async function DELETE(request: Request, context: RouteParams) {
  try {
    const lineId = await resolveLineId(context)
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
    const { cart, priceChanges: contextPriceChanges, versionBumpReason: contextVersionBumpReason } = resolvedCart

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

    const commandInput: CartLinesRemoveInput = { routeContext: resolved.routeContext, cartId: cart.id, lineId }
    // §10.1 has no slot for a removed line's own snapshot (removing it is exactly what the
    // caller asked for); `result` is discarded in favor of the full post-removal envelope.
    await commandBus.execute<CartLinesRemoveInput, CartLinesRemoveResult>(removeLineCommand.id, {
      input: commandInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    // Step 5.1 — `cart.lines.remove` never itself produces a repricing side effect;
    // `priceChanges`/`versionBumpReason` here can only come from the `resolveCurrentCart`-
    // embedded §5.2 trigger 2-4 check above. Step 5.2 — `.remove` always succeeds, so it
    // always returns the full §10.1 envelope (never the bare `{ outcome }` shape).
    const responseBody = await buildCartResponseEnvelope({
      container,
      cartId: cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
      priceChanges: contextPriceChanges,
      versionBumpReason: contextVersionBumpReason,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Update or remove a line on the current cart',
  pathParams: z.object({ lineId: z.string().uuid() }),
  methods: {
    PATCH: {
      summary: 'Change a line\'s quantity',
      requestBody: { contentType: 'application/json', schema: cartLineUpdateRequestSchema },
      responses: [{ status: 200, description: 'Line updated, or rejected as a non-fatal warning' }],
      errors: [
        { status: 400, description: 'Invalid request body' },
        { status: 404, description: 'No `X-Cart-Token` header, the token does not resolve a cart, or the line does not exist' },
        { status: 409, description: 'Optimistic-lock conflict, or the line is a promotion (gift) line (`promotion_line_immutable`)' },
        { status: 422, description: 'Quantity rule violation, or an unpriceable product' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
    DELETE: {
      summary: 'Remove a line',
      responses: [{ status: 200, description: 'Line removed' }],
      errors: [
        { status: 404, description: 'No `X-Cart-Token` header, the token does not resolve a cart, or the line does not exist' },
        { status: 409, description: 'Optimistic-lock conflict, or the line is a promotion (gift) line (`promotion_line_immutable`)' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
