import { NextResponse } from 'next/server'
import { z } from 'zod'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { Cart } from '../../../../data/entities'
import { cartProposalPreviewRequestSchema } from '../../../../data/validators'
import { signAcceptanceToken } from '../../../../lib/acceptanceToken'
import { buildProposalAcceptancePreview } from '../../../../lib/proposalPreview'
import { shouldEnforceAssortmentScope } from '../../../../lib/routeContext'
import {
  mapRouteErrorToResponse,
  notFoundCartResponse,
  readCartToken,
  resolveIdentifiedBasketByToken,
  resolveRouteContextOrError,
} from '../../../../lib/currentCartRoute'
import { enforceCartRateLimit } from '../../../../lib/rateLimit'

// Step 3.4 (§7a.4) — `POST /proposals/:id/preview`: "re-prices the proposal against the
// target's CURRENT buyer context, runs the §6a.5 visibility pass in dry-run, CREATES
// NOTHING, returns `{ acceptancePreview, acceptanceToken }`." `{ fresh: true }` on the route
// context (D-R4-22): "`preview` takes the scope the same way [as merge/lock] for its
// dry-run pass" — a stale group-membership scope here would hand the buyer a token bound to
// a scope `accept` would then re-resolve differently, 409ing for a reason the buyer cannot
// see coming.
export const metadata = {
  POST: { requireAuth: false },
}

const paramsSchema = z.object({ id: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> | { id: string } }

export async function POST(request: Request, context: RouteContext) {
  try {
    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) return notFoundCartResponse()

    const container = await createRequestContainer()
    const token = readCartToken(request)

    const limited = await enforceCartRateLimit(container, request, 'mutate', token)
    if (limited) return limited

    const resolved = await resolveRouteContextOrError(request, container, { fresh: true })
    if (!resolved.ok) return resolved.response
    if (!token) return notFoundCartResponse()

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    try {
      cartProposalPreviewRequestSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const scope = { tenantId: resolved.routeContext.tenantId, organizationId: resolved.routeContext.organizationId }
    const basket = await resolveIdentifiedBasketByToken(container, request, scope, token)
    if (!basket) return notFoundCartResponse()

    const em = (container.resolve('em') as EntityManager).fork()
    const target = await findOneWithDecryption(em, Cart, { id: basket.id, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'basket' as const }, {}, scope)
    if (!target) return notFoundCartResponse()
    const proposal = await findOneWithDecryption(
      em,
      Cart,
      { id: params.data.id, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'proposal' as const, proposedToCartId: target.id },
      {},
      scope,
    )
    if (!proposal) return notFoundCartResponse()

    const assortmentScope = shouldEnforceAssortmentScope(target.channel, resolved.routeContext.assortmentScope)
      ? resolved.routeContext.assortmentScope
      : undefined

    const acceptancePreview = await buildProposalAcceptancePreview({
      em,
      container,
      scope,
      target,
      proposal,
      assortmentScope,
    })
    const acceptanceToken = signAcceptanceToken({
      proposalCartId: proposal.id,
      targetCartId: target.id,
      proposalUpdatedAt: proposal.updatedAt.toISOString(),
      targetUpdatedAt: target.updatedAt.toISOString(),
    })

    return NextResponse.json({ acceptancePreview, acceptanceToken })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Dry-run re-price a proposal before accepting it',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Proposal acceptance preview (§7a.4)',
      description:
        'Re-prices every proposal line against the TARGET buyer\'s current context and re-checks visibility, without creating or mutating anything (TC-CART-PROP-10). Returns a 15-minute acceptanceToken bound to both carts\' current updatedAt, consumed by accept.',
      requestBody: { contentType: 'application/json', schema: cartProposalPreviewRequestSchema },
      responses: [{ status: 200, description: 'acceptancePreview + acceptanceToken' }],
      errors: [
        { status: 400, description: 'Invalid request body, or no resolved scope for a storefront target' },
        { status: 404, description: 'Unknown proposal id, a proposal addressed to a different basket, or the binding rule failed' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
