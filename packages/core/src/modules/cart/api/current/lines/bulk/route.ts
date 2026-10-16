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

import { bulkAddLinesCommand } from '../../../../commands/lines'
import type { CartLinesBulkAddEntryOutcome, CartLinesBulkAddInput, CartLinesBulkAddResult } from '../../../../commands/lines'
import { cartLineBulkAddRequestSchema } from '../../../../data/validators'
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
import {
  computeRequestDigest,
  findIdempotencyReplay,
  readIdempotencyKey,
  recordIdempotencyResponse,
} from '../../../../lib/idempotency'
import { enforceCartRateLimit } from '../../../../lib/rateLimit'

// Step 4.7 — `POST /current/lines/bulk` → `cart.lines.bulkAdd`. §10: "exists
// because B2B quick-order pads and agent proposals add 50 lines at once ... 50
// sequential mutations means 50 ... version conflicts" — a single call therefore
// carries ONE optimistic-lock check and ONE idempotency record for the whole
// batch, not one per entry; per-entry outcomes (including per-entry rejections)
// live inside the response body's `outcome.results` array.
export const metadata = {
  POST: { requireAuth: false },
}

/**
 * Always `200`: a batch call's HTTP status reports whether the REQUEST was
 * processed, not whether every entry was accepted — that is exactly what
 * `addedCount`/`rejectedCount` and each entry's own `status`/`reason` already
 * encode (§15a has no bulk-specific status; per-entry statuses still follow the
 * same `product_unavailable` = warning / quantity = hard-stop vocabulary the
 * single-line route uses, surfaced in the body rather than the top-level status
 * code since a single HTTP status cannot represent N independent outcomes).
 */
const BULK_ADD_STATUS = 200

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
    let body: z.infer<typeof cartLineBulkAddRequestSchema>
    try {
      body = cartLineBulkAddRequestSchema.parse(rawBody)
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

    // §8.2 ordering — see `lines/route.ts`'s identical note.
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

    const commandInput: CartLinesBulkAddInput = {
      routeContext: resolved.routeContext,
      cartId: cart.id,
      lines: body.lines,
    }
    const { result } = await commandBus.execute<CartLinesBulkAddInput, CartLinesBulkAddResult>(bulkAddLinesCommand.id, {
      input: commandInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    // Step 5.1 — same reasoning as the single-line add route: `cart.lines.bulkAdd` never
    // itself produces a repricing side effect, so `priceChanges`/`versionBumpReason` here
    // can only come from the `resolveCurrentCart`-embedded §5.2 trigger 2-4 check above.
    //
    // Step 5.2 — §10.1's generic envelope has no slot for "up to 100 independent per-entry
    // dispositions"; collapsing `outcome.results` into the handful of top-level `warnings`
    // the envelope DOES support would discard information no batch-endpoint client can do
    // without (which of the 100 entries succeeded, which were rejected, and why). `outcome`
    // is therefore kept as a deliberate, documented ADDITION alongside the mandated `cart`
    // envelope — not a replacement — for this one route only. Only `added`/`merged` entries
    // contribute a top-level `quantity_capped` warning (one per affected line); a rejected
    // entry's reason is already fully disclosed in `outcome.results[index]`, so it is not
    // duplicated as a lineless top-level warning the way the single-line route's rejected-
    // add case needs to be (there, `outcome` itself is dropped for the warning-level case).
    const { translate } = await resolveTranslations()
    const warnings: CartViewWarning[] = result.results
      .filter((entry): entry is Extract<CartLinesBulkAddEntryOutcome, { status: 'added' | 'merged' }> => entry.status === 'added' || entry.status === 'merged')
      .flatMap((entry) =>
        entry.warnings.map((code) => ({
          code,
          lineId: entry.line.id,
          message: resolveCartWarningMessage('quantity_capped', translate),
        })),
      )
    const envelope = await buildCartResponseEnvelope({
      container,
      cartId: cart.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      priceChanges: contextPriceChanges,
      versionBumpReason: contextVersionBumpReason,
      warnings,
    })
    const responseBody: Record<string, unknown> = { ...envelope, outcome: result }
    if (idempotencyKey) {
      await recordIdempotencyResponse(em, scope, cart.id, idempotencyKey, requestDigest, BULK_ADD_STATUS, responseBody)
    }
    return NextResponse.json(responseBody, { status: BULK_ADD_STATUS })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Batch-add lines to the current cart',
  methods: {
    POST: {
      summary: 'Add up to 100 product/variant lines in one call',
      description:
        'One optimistic-lock check and one `Idempotency-Key` record for the whole batch; each entry\'s own outcome (added/merged/rejected) is reported in `outcome.results`.',
      requestBody: { contentType: 'application/json', schema: cartLineBulkAddRequestSchema },
      responses: [{ status: 200, description: 'Batch processed — see `outcome.results` for per-entry outcomes' }],
      errors: [
        { status: 400, description: 'Invalid request body, or more than 100 entries' },
        { status: 404, description: 'No `X-Cart-Token` header, or the token does not resolve a cart' },
        { status: 409, description: 'Optimistic-lock conflict' },
        { status: 422, description: 'Idempotency key mismatch' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
