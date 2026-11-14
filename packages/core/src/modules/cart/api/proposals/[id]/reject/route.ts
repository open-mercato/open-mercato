import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { Cart } from '../../../../data/entities'
import { cartProposalRejectRequestSchema } from '../../../../data/validators'
import type { CartProposalRejectInput, CartProposalRejectResult } from '../../../../commands/proposal'
import { rejectProposalCommand } from '../../../../commands/proposal'
import {
  CART_RESOURCE_KIND,
  buildCommandContext,
  mapRouteErrorToResponse,
  notFoundCartResponse,
  readCartToken,
  resolveIdentifiedBasketByToken,
  resolveRouteContextOrError,
} from '../../../../lib/currentCartRoute'
import { enforceCartRateLimit } from '../../../../lib/rateLimit'

// Step 3.4 (§7a.5) — `POST /proposals/:id/reject`, the BUYER-facing caller of
// `cart.proposal.reject`: always `rejectedBy: 'buyer'`, the single thing distinguishing
// this route from every author-side ending (`assisted_selling`'s own withdraw/supersede/
// re-author routes, not built by this module). "It touches the target cart not at all" —
// no optimistic-lock header on this route: the resource this call mutates is the PROPOSAL
// cart, never the target, and §7a.5 states rejecting an already-non-active proposal is a
// no-op, not a conflict, so there is no "stale version" state for a lock header to guard.
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

    const resolved = await resolveRouteContextOrError(request, container)
    if (!resolved.ok) return resolved.response
    if (!token) return notFoundCartResponse()

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    try {
      cartProposalRejectRequestSchema.parse(rawBody)
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
    const proposal = await findOneWithDecryption(
      em,
      Cart,
      { id: params.data.id, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'proposal' as const, proposedToCartId: basket.id },
      {},
      scope,
    )
    if (!proposal) return notFoundCartResponse()

    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        userId: resolved.routeContext.customerUserId ?? 'anonymous',
        tenantId: resolved.routeContext.tenantId,
        organizationId: resolved.routeContext.organizationId,
        userFeatures: [],
      },
      input: { resourceKind: CART_RESOURCE_KIND, resourceId: proposal.id, operation: 'update', mutationPayload: {} },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx = buildCommandContext(container, request, resolved.routeContext)
    const commandInput: CartProposalRejectInput = {
      proposalCartId: proposal.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      rejectedBy: 'buyer',
    }
    const { result } = await commandBus.execute<CartProposalRejectInput, CartProposalRejectResult>(rejectProposalCommand.id, {
      input: commandInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    return NextResponse.json({ proposalCartId: result.proposalCartId, status: result.status })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Reject a proposal addressed to the current basket',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Buyer-side proposal rejection (§7a.5)',
      description: 'Sets the proposal to abandoned with resolvedAt; touches the target cart not at all. A no-op on an already non-active proposal, returning its current status.',
      requestBody: { contentType: 'application/json', schema: cartProposalRejectRequestSchema },
      responses: [{ status: 200, description: '{ proposalCartId, status }' }],
      errors: [
        { status: 404, description: 'Unknown proposal id, a proposal addressed to a different basket, or the binding rule failed' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
