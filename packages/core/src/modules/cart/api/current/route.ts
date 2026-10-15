import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { createCartCommand } from '../../commands/cart'
import type { CartCreateResult, CartCreateStorefrontInput } from '../../commands/cart'
import { cartCurrentCreateRequestSchema } from '../../data/validators'
import {
  CART_RESOURCE_KIND,
  buildCommandContext,
  mapRouteErrorToResponse,
  notFoundCartResponse,
  readCartToken,
  resolveCurrentCart,
  resolveRouteContextOrError,
} from '../../lib/currentCartRoute'
import { buildCartResponseEnvelope } from '../../lib/cartView'
import { enforceCartRateLimit } from '../../lib/rateLimit'

// Step 4.7 — `POST /current` (cart.create) and `GET /current` (cart.get), the two
// entry points named in the task. Both are anonymous/storefront routes (§6a.1a);
// neither accepts a staff session, so `metadata` declares no feature guard.
export const metadata = {
  POST: { requireAuth: false },
  GET: { requireAuth: false },
}

export async function POST(request: Request) {
  try {
    const container = await createRequestContainer()

    // §15a: `CART_CREATE` is IP-keyed only — no token exists before this call succeeds.
    const limited = await enforceCartRateLimit(container, request, 'create', null)
    if (limited) return limited

    const resolved = await resolveRouteContextOrError(request, container)
    if (!resolved.ok) return resolved.response

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    try {
      cartCurrentCreateRequestSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    // No cart exists yet, so there is nothing to key a mutation guard's
    // `resourceId` or an idempotency replay against — `lib/idempotency.ts`'s
    // `CartIdempotencyKey`-backed layer requires an EXISTING `cartId` by the
    // entity's own non-nullable FK (Step 4.2). `cart.create` is therefore exempt
    // from idempotency in this step; see that file's header note for why.
    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        userId: resolved.routeContext.customerUserId ?? 'anonymous',
        tenantId: resolved.routeContext.tenantId,
        organizationId: resolved.routeContext.organizationId,
        // Pre-supplied so the shared helper never resolves RBAC features for an
        // anonymous caller — `resolved.routeContext.customerUserId` is a
        // `customer_accounts.CustomerUser.id`, not an `auth.User.id`, and
        // `rbacService` would otherwise run a uuid-typed lookup against the
        // placeholder `'anonymous'` string for a guest.
        userFeatures: [],
      },
      input: { resourceKind: CART_RESOURCE_KIND, resourceId: null, operation: 'create' },
    })
    if (!guarded.ok) return guarded.response

    const ctx = buildCommandContext(container, request, resolved.routeContext)
    const commandBus = container.resolve('commandBus') as CommandBus
    const input: CartCreateStorefrontInput = { routeContext: resolved.routeContext }
    const { result } = await commandBus.execute<CartCreateStorefrontInput, CartCreateResult>(createCartCommand.id, {
      input,
      ctx,
    })

    await guarded.runAfterSuccess()

    // Step 5.2 — §10.1 envelope. `result` (`CartCreateResult`) is deliberately minimal
    // (cartId/token/channel/tenantId/organizationId — see `commands/cart.ts`'s own doc
    // comment); the full `CartView` is built by re-fetching the just-created (lineless) cart.
    const envelope = await buildCartResponseEnvelope({
      container,
      cartId: result.cartId,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      token: result.token,
    })

    return NextResponse.json(envelope, { status: 201 })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export async function GET(request: Request) {
  try {
    const container = await createRequestContainer()
    const token = readCartToken(request)

    const limited = await enforceCartRateLimit(container, request, 'read', token)
    if (limited) return limited

    const resolved = await resolveRouteContextOrError(request, container)
    if (!resolved.ok) return resolved.response
    if (!token) return notFoundCartResponse()

    const ctx = buildCommandContext(container, request, resolved.routeContext)
    const commandBus = container.resolve('commandBus') as CommandBus
    const resolvedCart = await resolveCurrentCart(commandBus, ctx, resolved.routeContext, token)
    if (!resolvedCart) return notFoundCartResponse()

    // Step 5.1 — `priceChanges`/`versionBumpReason` are present only when §5.2 triggers 2-4
    // actually ran a re-price for this request (`resolveCurrentCart` -> `cart.get` ->
    // `cart.reprice`); an ordinary GET inside the staleness budget with no digest drift
    // omits both. Step 5.2 — every response is now the full §10.1 envelope, not the bare
    // `CartSummary` this route used to return with no `lines` array at all.
    const { cart, priceChanges, versionBumpReason } = resolvedCart
    const envelope = await buildCartResponseEnvelope({
      container,
      cartId: cart.id,
      tenantId: cart.tenantId,
      organizationId: cart.organizationId,
      priceChanges,
      versionBumpReason,
    })

    return NextResponse.json(envelope)
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Current storefront cart',
  methods: {
    POST: {
      summary: 'Create a new storefront cart',
      description:
        'Anonymous, storefront-channel only (§6a.4 channel creation is out of scope for this public route). Returns the plaintext cart token exactly once (§8.3) — never again.',
      requestBody: { contentType: 'application/json', schema: cartCurrentCreateRequestSchema },
      responses: [{ status: 201, description: 'Cart created' }],
      errors: [
        { status: 400, description: 'Invalid request body' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
    GET: {
      summary: 'Read the current cart',
      description: 'Resolves the cart addressed by the `X-Cart-Token` header, scoped to `kind = basket` only.',
      headers: z.object({ 'X-Cart-Token': z.string().optional() }),
      responses: [{ status: 200, description: 'Cart found' }],
      errors: [
        { status: 404, description: 'No `X-Cart-Token` header, or the token does not resolve a cart' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
