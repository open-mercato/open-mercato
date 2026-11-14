import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { cartProposalAcceptRequestSchema } from '../../../../data/validators'
import type { CartProposalAcceptInput, CartProposalAcceptResult } from '../../../../commands/proposal'
import { acceptProposalCommand } from '../../../../commands/proposal'
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

// Step 3.4 (§7a.4) — `POST /proposals/:id/accept`: per-line acceptance, delegating to
// `cart.merge { proposalCartId, lines }` through `cart.proposal.accept`
// (`commands/proposal.ts`). `{ fresh: true }` for the SAME reason the ordinary
// `/current/merge` route resolves fresh (D-R4-22): acceptance is a merge.
//
// No separate optimistic-lock header on this route (documented judgment call): the
// `acceptanceToken` returned by `preview` ALREADY binds both the target's AND the
// proposal's current `updatedAt` (§7a.4) and is verified by `cart.proposal.accept` itself —
// a second, independent `If-Match`-style check here would duplicate that exact guarantee
// for no added protection, while forcing a client to thread an extra header through a
// two-step flow that never asked it to capture one.
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
    let body: z.infer<typeof cartProposalAcceptRequestSchema>
    try {
      body = cartProposalAcceptRequestSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const scope = { tenantId: resolved.routeContext.tenantId, organizationId: resolved.routeContext.organizationId }
    const basket = await resolveIdentifiedBasketByToken(container, request, scope, token)
    if (!basket) return notFoundCartResponse()

    const guarded = await runRouteMutationGuards({
      container,
      req: request,
      auth: {
        userId: resolved.routeContext.customerUserId ?? 'anonymous',
        tenantId: resolved.routeContext.tenantId,
        organizationId: resolved.routeContext.organizationId,
        userFeatures: [],
      },
      input: { resourceKind: CART_RESOURCE_KIND, resourceId: basket.id, operation: 'update', mutationPayload: body },
    })
    if (!guarded.ok) return guarded.response

    const commandBus = container.resolve('commandBus') as CommandBus
    const ctx = buildCommandContext(container, request, resolved.routeContext)
    const commandInput: CartProposalAcceptInput = {
      proposalCartId: params.data.id,
      targetCartId: basket.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      acceptanceToken: body.acceptanceToken,
      lines: body.lines,
      routeContext: resolved.routeContext,
    }
    const { result } = await commandBus.execute<CartProposalAcceptInput, CartProposalAcceptResult>(acceptProposalCommand.id, {
      input: commandInput,
      ctx,
    })

    await guarded.runAfterSuccess()

    return NextResponse.json({
      cart: { token: result.token, updatedAt: result.cart.updatedAt },
      mergeSummary: result.mergeSummary,
      priceChanges: result.priceChanges,
      ...(result.warnings ? { warnings: result.warnings } : {}),
      acceptedLineCount: result.acceptedLineCount,
    })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Accept a proposal, per line',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Proposal acceptance (§7a.4)',
      description:
        'Per-line acceptance against a fresh acceptanceToken from preview; a stale token (either cart moved) 409s with a fresh preview+token. Delegates to cart.merge { strategy: "manual" } — unselected lines are recorded declined, never merged or deleted.',
      requestBody: { contentType: 'application/json', schema: cartProposalAcceptRequestSchema },
      responses: [{ status: 200, description: 'The survivor cart, mergeSummary and priceChanges' }],
      errors: [
        { status: 400, description: 'Invalid request body, or an unknown proposalLineId' },
        { status: 404, description: 'Unknown proposal id, a proposal addressed to a different basket, or the binding rule failed' },
        { status: 409, description: 'proposal_changed (stale acceptanceToken), cart_not_active, or proposal_accept_empty' },
        { status: 423, description: 'cart_locked — the target is mid-checkout' },
        { status: 429, description: 'Rate limited' },
        { status: 503, description: 'No store context resolvable for this request (§6a.1a)' },
      ],
    },
  },
}
