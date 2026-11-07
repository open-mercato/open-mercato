import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { mergeUndoCommand } from '../../../commands/merge'
import type { CartMergeUndoInput, CartMergeUndoResult } from '../../../commands/merge'
import { cartMergeUndoRequestSchema } from '../../../data/validators'
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
import { enforceCartRateLimit } from '../../../lib/rateLimit'

// Step 7.3 — `POST /current/undo-merge` -> `cart.mergeUndo` (§10 "Reverse within 15 min",
// §7.2). The cart to restore is found from the PRESENTED token, not a caller-supplied id —
// for an ordinary (non-adoption) merge this is the same cart the merge's own target was;
// for an undone ADOPTION this is reachable only via the NEW, rotated token the merge
// response returned (see `commands/merge.ts`'s `restoreCartMerge` doc comment for why that
// asymmetry is inherent, not an oversight).
//
// D-R4-22 names "lock and merge routes" for `{ fresh: true }` buyer-context resolution —
// `undo-merge` is neither, so this route resolves the ordinary (possibly 60s-cached)
// context like every other `/current/*` route. Documented judgment call: undo restores
// PAST state from `CartMergeLog`, it does not need the same just-this-instant freshness
// guarantee the original merge/lock decisions do.
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
    try {
      cartMergeUndoRequestSchema.parse(rawBody)
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
      // `operation: 'update'` — judgment call, documented: undo reverts the cart to an
      // earlier state rather than creating or deleting the cart resource itself, which
      // reads closer to an update than a create/delete for the mutation-guard registry's
      // own three-bucket vocabulary.
      input: { resourceKind: CART_RESOURCE_KIND, resourceId: cart.id, operation: 'update', mutationPayload: {} },
    })
    if (!guarded.ok) return guarded.response

    enforceCommandOptimisticLock({
      resourceKind: CART_RESOURCE_KIND,
      resourceId: cart.id,
      current: cart.updatedAt,
      request,
    })

    const commandInput: CartMergeUndoInput = {
      cartId: cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
      routeContext: resolved.routeContext,
    }
    const { result } = await commandBus.execute<CartMergeUndoInput, CartMergeUndoResult>(mergeUndoCommand.id, {
      input: commandInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    const responseBody = await buildCartResponseEnvelope({
      container,
      cartId: result.cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
      priceChanges: result.priceChanges,
      versionBumpReason: 'merge',
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Reverse the most recent merge into the current cart',
  methods: {
    POST: {
      summary: 'Undo the last merge, within 15 minutes',
      description:
        'Finds the most recent CartMergeLog row targeting the current cart and reverses it exactly: restores summed/capped target line quantities, deletes union-created target lines, restores the absorbed cart to active (or expired) and, for an undone adoption, restores the survivor\'s pre-merge buyer identity. Forces a mandatory whole-cart re-price afterward (§7.3). Carries the standard optimistic-lock header (§8.1).',
      requestBody: { contentType: 'application/json', schema: cartMergeUndoRequestSchema },
      responses: [{ status: 200, description: 'Merge reversed; the envelope carries the restored cart' }],
      errors: [
        { status: 400, description: 'Invalid request body' },
        { status: 404, description: 'No `X-Cart-Token` header, the token does not resolve a cart, or no merge exists to undo for this cart' },
        { status: 409, description: 'Optimistic-lock conflict, `merge_undo_window_expired` (the 15-minute window has passed), or `merge_undo_not_supported_for_proposal` (rev 10 — D-R5-25: the merge being undone was a proposal acceptance)' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
