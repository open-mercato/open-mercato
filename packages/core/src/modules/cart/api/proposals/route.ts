import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

import { Cart } from '../../data/entities'
import { cartProposalAuthorRequestSchema } from '../../data/validators'
import type { CartProposalCreateInput, CartProposalCreateResult } from '../../commands/proposal'
import { createProposalCommand } from '../../commands/proposal'
import {
  mapRouteErrorToResponse,
  notFoundCartResponse,
  readCartToken,
  resolveIdentifiedBasketByToken,
  resolveRouteContextOrError,
} from '../../lib/currentCartRoute'
import { enforceCartRateLimit } from '../../lib/rateLimit'

const logger = createLogger('cart').child({ component: 'api' })

// Step 3.4 (§7a.2/§7a.4, §10) — `/api/cart/proposals` hosts BOTH the buyer-facing `GET`
// (live proposals addressed to the presented token's basket) and the author-facing `POST`
// (§10's own text: "the ONE route on this base path that a cart token cannot reach" —
// authored by a staff/API-key principal holding `cart.proposals.author`, with NO cart
// token at all). Per-method `metadata` below: the route dispatcher
// (`apps/mercato/src/app/api/[...slug]/route.ts#extractMethodMetadata`) reads
// `metadata[method]` independently per HTTP verb, so `GET`'s `requireAuth: false` and
// `POST`'s `requireAuth: true, requireFeatures: [...]` apply exactly as declared — R15's
// `401`/`403` for `POST` is enforced by the dispatcher itself, before this file's `POST`
// handler ever runs (confirmed against the dispatcher's own source; mirrors
// `customer_groups/api/customer-groups/credit-accounts/[id]/adjust/route.ts`'s identical
// per-method-metadata, hand-written-command-route shape).
export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: true, requireFeatures: ['cart.proposals.author'] },
}

/**
 * §10: "Live proposals addressed to the presented token's basket, newest first." Only
 * `status: 'active'` rows — an expired/rejected/accepted proposal drops off this LIST
 * (documented judgment call: the spec's own word "Live" is read as the filter, not merely
 * as flavour text) but stays individually readable at ANY status via `GET /proposals/:id`
 * (TC-CART-PROP-16's "is readable" applies to the DETAIL route, not this one).
 */
export async function GET(request: Request) {
  try {
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
    const proposals = (await findWithDecryption(
      em,
      Cart,
      { kind: 'proposal' as const, proposedToCartId: basket.id, status: 'active' as const, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { orderBy: { createdAt: 'DESC' } },
      scope,
    )) as Cart[]

    return NextResponse.json({
      proposals: proposals.map((proposal) => ({
        proposalCartId: proposal.id,
        targetCartId: basket.id,
        status: proposal.status,
        totals: proposal.totals,
        createdAt: proposal.createdAt,
        expiresAt: proposal.expiresAt,
      })),
    })
  } catch (error) {
    return mapRouteErrorToResponse(error)
  }
}

const paramsSchema = cartProposalAuthorRequestSchema

export async function POST(request: Request) {
  const { translate } = await resolveTranslations()
  try {
    const container = await createRequestContainer()
    const auth = await getAuthFromRequest(request)
    // Defense in depth: the dispatcher's own `requireAuth: true` already refuses this
    // request before the handler runs — see the module-level comment. Mirrors
    // `customer_groups`' own `/adjust` route, which keeps this exact belt-and-suspenders
    // check despite the same metadata-level gate.
    if (!auth) {
      throw new CrudHttpError(401, { error: translate('cart.errors.unauthorized', 'Unauthorized') })
    }
    const tenantId = auth.tenantId ?? null
    if (!tenantId) {
      throw new CrudHttpError(400, { error: translate('cart.errors.tenant_required', 'Tenant context is required') })
    }

    const rawBody = (await readJsonSafe<Record<string, unknown>>(request, {})) ?? {}
    let body: z.infer<typeof paramsSchema>
    try {
      body = paramsSchema.parse(rawBody)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid request body', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const ctx: CommandRuntimeContext = {
      container,
      auth,
      organizationScope: null,
      selectedOrganizationId: auth.orgId ?? null,
      organizationIds: null,
      request,
    }

    const commandInput: CartProposalCreateInput = {
      targetCartId: body.targetCartId,
      lines: body.lines,
      ttlSeconds: body.ttlSeconds,
    }

    const commandBus = container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<CartProposalCreateInput, CartProposalCreateResult>(createProposalCommand.id, {
      input: commandInput,
      ctx,
    })

    return NextResponse.json({
      proposalCartId: result.proposalCartId,
      lines: result.lines,
      totals: result.totals,
      rejectedLines: result.rejectedLines,
      ...(result.warnings ? { warnings: result.warnings } : {}),
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    const interceptorRejection = getCommandInterceptorHttpRejection(err)
    if (interceptorRejection) return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
    logger.error('cart.proposal.create failed', { err })
    getTelemetryRuntime()?.reportError(err, { module: 'cart', code: 'cart.proposal_create_failed' })
    return NextResponse.json({ error: translate('cart.errors.unexpected', 'Unexpected error') }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Cart',
  summary: 'List and author proposal carts',
  methods: {
    GET: {
      summary: 'Live proposals addressed to the current basket (§7a.4)',
      description: 'Only `active` (live) proposals, newest first. Token-bound (X-Cart-Token) plus the D-R5-13/D-R5-21 identified-buyer binding.',
      responses: [{ status: 200, description: 'The live proposals addressed to this basket' }],
      errors: [{ status: 429, description: 'Rate limited' }, { status: 503, description: 'No store context resolvable for this request' }],
    },
    POST: {
      summary: 'Author a proposal (§7a.2)',
      description: 'Requires an authenticated principal holding cart.proposals.author. No cart token at all — this is the one route on this base path a leaked buyer token cannot reach (R15).',
      requestBody: { contentType: 'application/json', schema: cartProposalAuthorRequestSchema },
      responses: [{ status: 200, description: 'The newly authored proposal cart' }],
      errors: [
        { status: 400, description: 'Invalid body, or assortment_scope_required_for_storefront_channel' },
        { status: 401, description: 'Unauthorized' },
        { status: 403, description: 'Missing cart.proposals.author' },
        { status: 404, description: 'targetCartId does not resolve a basket in the caller\'s tenant/organization' },
        { status: 409, description: 'cart_not_active' },
        { status: 422, description: 'proposal_empty' },
        { status: 423, description: 'cart_locked' },
      ],
    },
  },
}
