import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { Cart, CartLine } from '../../../data/entities'
import { toCartLineSnapshot } from '../../../commands/lines'
import {
  mapRouteErrorToResponse,
  notFoundCartResponse,
  readCartToken,
  resolveIdentifiedBasketByToken,
  resolveRouteContextOrError,
} from '../../../lib/currentCartRoute'
import { enforceCartRateLimit } from '../../../lib/rateLimit'

// Step 3.4 (§7a.4) — `GET /proposals/:id`: detail for ONE proposal addressed to the
// presented token's basket. Readable at ANY status (TC-CART-PROP-16: "an expired proposal
// is readable, is not accept-able") — unlike `GET /proposals`'s list, which only surfaces
// LIVE (`active`) ones (see that route's own doc comment for the reasoning). Buyer-facing,
// token-bound, no ACL feature — the same posture every other `/proposals/*` buyer route
// takes (§10.3: "Acceptance and rejection carry no feature... a guest buyer has no ACL
// identity to check").
export const metadata = {
  GET: { requireAuth: false },
}

const paramsSchema = z.object({ id: z.string().uuid() })
type RouteContext = { params: Promise<{ id: string }> | { id: string } }

export async function GET(request: Request, context: RouteContext) {
  try {
    const params = paramsSchema.safeParse(await context.params)
    if (!params.success) return notFoundCartResponse()

    const container = await createRequestContainer()
    const token = readCartToken(request)

    const limited = await enforceCartRateLimit(container, request, 'read', token)
    if (limited) return limited

    const resolved = await resolveRouteContextOrError(request, container)
    if (!resolved.ok) return resolved.response
    if (!token) return notFoundCartResponse()

    const scope = { tenantId: resolved.routeContext.tenantId, organizationId: resolved.routeContext.organizationId }
    const basket = await resolveIdentifiedBasketByToken(container, request, scope, token)
    if (!basket) return notFoundCartResponse()

    const em = (container.resolve('em') as EntityManager).fork()
    // §7a.4/K10: a proposal id that is not addressed to THIS basket answers the same
    // structural 404 as a nonexistent id (TC-CART-PROP-07).
    const proposal = await findOneWithDecryption(
      em,
      Cart,
      { id: params.data.id, tenantId: scope.tenantId, organizationId: scope.organizationId, kind: 'proposal' as const, proposedToCartId: basket.id },
      {},
      scope,
    )
    if (!proposal) return notFoundCartResponse()

    const lines = (await findWithDecryption(
      em,
      CartLine,
      { cartId: proposal.id, deletedAt: null, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )) as CartLine[]

    return NextResponse.json({
      proposal: {
        proposalCartId: proposal.id,
        targetCartId: basket.id,
        status: proposal.status,
        totals: proposal.totals,
        lines: lines.map(toCartLineSnapshot),
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
        resolvedAt: proposal.resolvedAt ?? null,
        updatedAt: proposal.updatedAt,
      },
    })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'Read one proposal addressed to the current basket',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: {
      summary: 'Proposal detail (§7a.4)',
      description:
        'Readable at any status — an expired/rejected/accepted proposal stays readable for the buyer and the author\'s own history (§7a.3). Token-bound (X-Cart-Token) plus the D-R5-13/D-R5-21 identified-buyer binding.',
      responses: [{ status: 200, description: 'The proposal and its lines' }],
      errors: [{ status: 404, description: 'Unknown proposal id, a proposal addressed to a different basket, or the binding rule failed' }],
    },
  },
}
