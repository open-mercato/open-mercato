import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

import { mergeCartCommand } from '../../../commands/merge'
import type { CartMergeInput, CartMergeResult } from '../../../commands/merge'
import { cartMergeRequestSchema } from '../../../data/validators'
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

// Step 7.3 — `POST /current/merge` -> `cart.merge` (§10 "Merge a guest cart into the
// session's cart; resolves the target's scope **fresh** (D-R4-22)").
//
// The `X-Cart-Token` header names the TARGET (the buyer's own logged-in session cart);
// the body's `sourceToken` names the SOURCE (guest) cart being merged in — see
// `data/validators.ts`'s `cartMergeRequestSchema` for the documented judgment call on this
// body shape, which the spec's own route table never states explicitly.
//
// `{ fresh: true }` on the route-context resolution (not the default every other
// `/current/*` route uses) per D-R4-22: "the merge and lock route edges call
// storeContextService.resolve(request, { fresh: true })... because a merge ... is
// precisely the moment a stale membership must not be trusted."
export const metadata = {
  POST: { requireAuth: false },
}

export async function POST(request: Request) {
  try {
    const container = await createRequestContainer()
    const token = readCartToken(request)

    const limited = await enforceCartRateLimit(container, request, 'mutate', token)
    if (limited) return limited

    const resolved = await resolveRouteContextOrError(request, container, { fresh: true })
    if (!resolved.ok) return resolved.response
    if (!token) return notFoundCartResponse()

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx = buildCommandContext(container, request, resolved.routeContext)
    const resolvedCart = await resolveCurrentCart(commandBus, ctx, resolved.routeContext, token)
    if (!resolvedCart) return notFoundCartResponse()
    const { cart } = resolvedCart

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    let body: z.infer<typeof cartMergeRequestSchema>
    try {
      body = cartMergeRequestSchema.parse(rawBody)
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

    // Keyed to the TARGET cart's own `updatedAt` — the cart the buyer's session/token
    // actually names, per the task brief. The SURVIVING cart after a `strategy: 'replace'`
    // (adopt) merge may be a different row entirely (the former guest cart) — its own
    // version has nothing to do with the lock the CALLER's session is protecting.
    enforceCommandOptimisticLock({
      resourceKind: CART_RESOURCE_KIND,
      resourceId: cart.id,
      current: cart.updatedAt,
      request,
    })

    const commandInput: CartMergeInput = {
      targetCartId: cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
      sourceToken: body.sourceToken,
      routeContext: resolved.routeContext,
    }
    const { result } = await commandBus.execute<CartMergeInput, CartMergeResult>(mergeCartCommand.id, {
      input: commandInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    const { translate } = await resolveTranslations()
    const warnings: CartViewWarning[] | undefined = result.warnings?.map((warning) =>
      warning.code === 'product_unavailable'
        ? { code: warning.code, message: resolveCartWarningMessage('product_unavailable', translate) }
        : { code: warning.code, message: resolveCartWarningMessage('promotion_no_longer_valid', translate) },
    )
    const responseBody = await buildCartResponseEnvelope({
      container,
      // The SURVIVING cart — for `strategy: 'replace'` this is the former guest cart, not
      // `cart.id` above (the session's original target, now absorbed and dead).
      cartId: result.cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
      // Rotated unconditionally by `cart.merge` (§8.3) — always present on this response.
      token: result.token,
      priceChanges: result.priceChanges,
      versionBumpReason: 'merge',
      warnings,
      mergeSummary: result.mergeSummary,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Merge a guest cart into the session cart',
  methods: {
    POST: {
      summary: 'Merge a guest (source) cart into the current (target) cart',
      description:
        'Resolves the target cart from the X-Cart-Token header and the source (guest) cart from the body\'s sourceToken, applies §7.1\'s merge policy, writes a CartMergeLog, rotates the surviving cart\'s token, and forces a mandatory whole-cart re-price (§7.3). Carries the standard optimistic-lock header (§8.1), keyed to the TARGET cart.',
      requestBody: { contentType: 'application/json', schema: cartMergeRequestSchema },
      responses: [{ status: 200, description: 'Merge applied; the envelope carries the surviving cart, a rotated token, and mergeSummary (§10.1/§7.2)' }],
      errors: [
        { status: 400, description: 'Invalid request body, the source and target resolve to the same cart, or `cart_merge_scope_mismatch` (different store or currency)' },
        { status: 404, description: 'No `X-Cart-Token` header, the token does not resolve a cart, or sourceToken does not resolve a (different, active) basket' },
        { status: 409, description: 'Optimistic-lock conflict' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
