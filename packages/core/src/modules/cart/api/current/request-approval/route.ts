import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { requestApprovalCommand } from '../../../commands/approval'
import type { CartRequestApprovalInput, CartRequestApprovalResult } from '../../../commands/approval'
import { cartRequestApprovalRequestSchema } from '../../../data/validators'
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

// Step 3.2 (K4, §9a.4/§10) — `POST /current/request-approval` -> `cart.approval.request`.
// Structurally identical to `current/undo-merge/route.ts` (this Step's own named
// precedent): no caller-supplied id, no body fields, the SAME optimistic-lock +
// mutation-guard + rate-limit wiring every other `/current/*` mutation applies. §10's own
// text for this route does not name `{ fresh: true }` (unlike merge/lock, D-R4-22), so the
// ordinary (possibly 60s-cached) route-context resolution applies — this route never reads
// `routeContext.assortmentScope` at all, only `tenantId`/`organizationId` to scope the cart
// lookup, so staleness there cannot affect anything this route does.
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
      cartRequestApprovalRequestSchema.parse(rawBody)
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
      input: { resourceKind: CART_RESOURCE_KIND, resourceId: cart.id, operation: 'update', mutationPayload: {} },
    })
    if (!guarded.ok) return guarded.response

    enforceCommandOptimisticLock({
      resourceKind: CART_RESOURCE_KIND,
      resourceId: cart.id,
      current: cart.updatedAt,
      request,
    })

    const commandInput: CartRequestApprovalInput = {
      cartId: cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
    }
    const { result } = await commandBus.execute<CartRequestApprovalInput, CartRequestApprovalResult>(
      requestApprovalCommand.id,
      { input: commandInput, ctx },
    )

    await guarded.runAfterSuccess()

    const responseBody = await buildCartResponseEnvelope({
      container,
      cartId: result.cart.id,
      tenantId: resolved.routeContext.tenantId,
      organizationId: resolved.routeContext.organizationId,
    })

    return NextResponse.json(responseBody)
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Request B2B purchase approval for the current cart',
  methods: {
    POST: {
      summary: 'Request approval (idempotent while pending, §9a.4)',
      description:
        'Recomputes requiresApproval from fresh terms, then either returns the already-pending approval that still covers the cart (idempotent, §9a.4 step 3), supersedes a stale pending one, or requests a new one via customer_groups. Requires the identified buyer\'s own session (§8.4) — a guest basket is refused. Carries the standard optimistic-lock header (§8.1).',
      requestBody: { contentType: 'application/json', schema: cartRequestApprovalRequestSchema },
      responses: [{ status: 200, description: 'The envelope carries the cart with its live approval and awaitingApprovalSince (§10.1)' }],
      errors: [
        { status: 404, description: 'No X-Cart-Token header, the token does not resolve a cart, or the identity binding fails (§8.4)' },
        { status: 409, description: 'approval_requires_identified_buyer (guest basket, K4), approval_not_required (no threshold crossed, or an existing approval already qualifies), cart_not_active, or an optimistic-lock conflict' },
        { status: 423, description: 'cart_locked — the cart is mid-checkout' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a), or customer_groups\' approval service is unavailable' },
      ],
    },
  },
}
