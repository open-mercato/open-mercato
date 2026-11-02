import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

import { addLineCommand } from '../../../commands/lines'
import type { CartLinesAddInput, CartLinesAddOutcome } from '../../../commands/lines'
import { cartLineAddRequestSchema } from '../../../data/validators'
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
import {
  computeRequestDigest,
  findIdempotencyReplay,
  readIdempotencyKey,
  recordIdempotencyResponse,
} from '../../../lib/idempotency'
import { enforceCartRateLimit } from '../../../lib/rateLimit'

// Step 4.7 — `POST /current/lines` → `cart.lines.add`.
export const metadata = {
  POST: { requireAuth: false },
}

/**
 * §15a's error-code catalogue maps the outcome union: `product_unavailable` is a
 * `200` warning (§6a.3 — never a distinguishable error, restricted and
 * nonexistent collapse identically); `quantity_below_minimum`/
 * `quantity_invalid_increment` are hard `422`s (`quantity_below_min` /
 * `quantity_increment_violation`), carrying `nearestValid`.
 * `product_not_priceable` has no catalogue entry — treated as the same hard-stop
 * `422` family rather than invented as a silent `200`, since (unlike visibility)
 * the spec never names it a warning.
 */
function statusForAddOutcome(outcome: CartLinesAddOutcome): number {
  if (outcome.status === 'added') return 201
  if (outcome.status === 'merged') return 200
  if (outcome.reason === 'product_unavailable') return 200
  return 422
}

/**
 * Step 5.2 — §10.1's "every endpoint returns the same envelope" applies to every outcome
 * whose own status is a non-fatal 200/201 (added/merged/the product_unavailable warning);
 * a genuinely hard-stop 422 (quantity/pricing rule) keeps the pre-existing bare `{ outcome }`
 * body — that error-presentation design is §15a's/Step 5.3's territory, not this step's, and
 * nothing in `outcome.results`-shaped data belongs in a `CartView` anyway (no line exists to
 * describe). See `lib/cartView.ts`'s own doc comment for the rest of this step's judgment
 * calls.
 */
function isWarningLevelOutcome(outcome: CartLinesAddOutcome): boolean {
  return outcome.status !== 'rejected' || outcome.reason === 'product_unavailable'
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
    const { cart, priceChanges: contextPriceChanges, versionBumpReason: contextVersionBumpReason } = resolvedCart

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    let body: z.infer<typeof cartLineAddRequestSchema>
    try {
      body = cartLineAddRequestSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const scope = { tenantId: resolved.routeContext.tenantId, organizationId: resolved.routeContext.organizationId }
    const idempotencyKey = readIdempotencyKey(request)
    const requestDigest = computeRequestDigest(body)
    const em = (container.resolve('em') as EntityManager).fork()

    // §8.2: "the idempotency lookup precedes the optimistic-lock check" — a retry
    // whose response was lost carries the PRE-mutation `updatedAt`, which a lock
    // check run first would 409 against the cart the original request itself
    // already changed. A replay also skips the mutation guard entirely: the guard
    // already ran (and passed, or this row would not exist) for the original call.
    if (idempotencyKey) {
      const replay = await findIdempotencyReplay(em, scope, cart.id, idempotencyKey, requestDigest)
      if (replay) return NextResponse.json(replay.body, { status: replay.status })
    }

    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        userId: resolved.routeContext.customerUserId ?? 'anonymous',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
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

    const commandInput: CartLinesAddInput = {
      routeContext: resolved.routeContext,
      cartId: cart.id,
      productId: body.productId,
      variantId: body.variantId ?? null,
      quantity: body.quantity,
      configuration: body.configuration ?? null,
      metadata: body.metadata ?? null,
    }
    const { result } = await commandBus.execute<CartLinesAddInput, CartLinesAddOutcome>(addLineCommand.id, {
      input: commandInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    const status = statusForAddOutcome(result)
    // Step 5.1 — `cart.lines.add` never itself produces a repricing side effect (a brand
    // new/merged line is priced, not re-priced); `priceChanges`/`versionBumpReason` here can
    // only come from the `resolveCurrentCart`-embedded §5.2 trigger 2-4 check above.
    let responseBody: Record<string, unknown>
    if (isWarningLevelOutcome(result)) {
      const { translate } = await resolveTranslations()
      const warnings: CartViewWarning[] =
        result.status === 'added' || result.status === 'merged'
          ? result.warnings.map((code) => ({
              code,
              lineId: result.line.id,
              message: resolveCartWarningMessage('quantity_capped', translate),
            }))
          : [{ code: 'product_unavailable', message: resolveCartWarningMessage('product_unavailable', translate) }]
      responseBody = await buildCartResponseEnvelope({
        container,
        cartId: cart.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        priceChanges: contextPriceChanges,
        versionBumpReason: contextVersionBumpReason,
        warnings,
      })
    } else {
      responseBody = { outcome: result }
      if (contextPriceChanges.length > 0) responseBody.priceChanges = contextPriceChanges
      if (contextVersionBumpReason) responseBody.versionBumpReason = contextVersionBumpReason
    }
    if (idempotencyKey) {
      await recordIdempotencyResponse(em, scope, cart.id, idempotencyKey, requestDigest, status, responseBody)
    }
    return NextResponse.json(responseBody, { status })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Add a line to the current cart',
  methods: {
    POST: {
      summary: 'Add a product/variant line to the current cart',
      description:
        'Visibility-checked on every call (§6a.1c). Accepts `Idempotency-Key` (§8.2) and the standard optimistic-lock header (§8.1).',
      requestBody: { contentType: 'application/json', schema: cartLineAddRequestSchema },
      responses: [{ status: 201, description: 'Line added' }, { status: 200, description: 'Line merged into an existing line, or rejected as a non-fatal warning' }],
      errors: [
        { status: 400, description: 'Invalid request body' },
        { status: 404, description: 'No `X-Cart-Token` header, or the token does not resolve a cart' },
        { status: 409, description: 'Optimistic-lock conflict, or the cart is a `proposal` cart' },
        { status: 422, description: 'Quantity rule violation, idempotency key mismatch, or an unpriceable product' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
