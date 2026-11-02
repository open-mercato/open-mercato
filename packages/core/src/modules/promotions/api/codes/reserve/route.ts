import { NextResponse } from 'next/server'
import { z } from 'zod'
import { asValue } from 'awilix'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { codeReserveInputSchema } from '../../../data/validators'
import type { PromotionsService, ReserveCodeInput } from '../../../lib/types'

const logger = createLogger('promotions')

// SPEC-055 §Cart-Facing Endpoints `POST /api/promotions/codes/reserve` (Release 4 PLAN.md
// Step 6.7) — thin HTTP adapter over the already-built `promotionsService.reserveCode()`
// (Step 6.2). Same `getAuthFromRequest(req)` standard auth model as `api/evaluate/route.ts`
// and `api/codes/[id]/generate/route.ts`; gated by `promotions.codes.redeem` per §Release 4
// Contract Freeze's already-declared ACL feature. `organizationId`/`tenantId` are never
// read from the request body — they come from `auth`, resolved below.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.codes.redeem'] },
}

type RouteContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  userId: string
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId || !auth.sub) {
    throw new CrudHttpError(401, { error: translate('promotions.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('promotions.errors.organization_required', 'Organization context is required'),
    })
  }
  // `promotionsService.reserveCode()` resolves scope from whatever `auth` is registered on
  // ITS OWN container at call time (`lib/promotions-service.ts`'s
  // `resolvePromotionsServiceAuthAndScope`) — same documented in-process caller contract
  // `api/evaluate/route.ts` already follows.
  container.register({ auth: asValue({ ...auth, orgId: organizationId }) })
  return { container, userId: auth.sub, tenantId: auth.tenantId, organizationId, translate }
}

export async function POST(req: Request) {
  try {
    const { container, userId, tenantId, organizationId } = await resolveRouteContext(req)
    const body = await readJsonSafe(req, {})

    let input: ReserveCodeInput
    try {
      input = codeReserveInputSchema.parse(body) as ReserveCodeInput
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid codes/reserve payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    // Custom write route (not `makeCrudRoute`) — wired through the mutation guard
    // registry per `packages/core/AGENTS.md` → "API Routes". Mirrors the parent-aggregate
    // convention `cart`'s own write routes use (`CART_RESOURCE_KIND` keyed to the cart
    // regardless of which child table a given write touches): a code reservation is a
    // sub-resource of its `Code`, so the resource kind is `promotions.code`. No resolved
    // `Code` row exists yet at this point (resolving one would duplicate
    // `resolveCodeByString`'s own lookup inside the service for no guard benefit), so
    // `resourceId` stays `null` — the same choice `cart`'s own creation route
    // (`api/current/route.ts`) makes when no aggregate id exists yet.
    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId, organizationId },
      input: { resourceKind: 'promotions.code', resourceId: null, operation: 'create', mutationPayload: input as unknown as Record<string, unknown> },
    })
    if (!guarded.ok) return guarded.response

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const result = await promotionsService.reserveCode(input)

    await guarded.runAfterSuccess()

    return NextResponse.json(result)
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.codes.reserve failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.code_reserve_failed', 'Failed to reserve the promotion code') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Reserve a promotion code against a cart',
  methods: {
    POST: {
      summary: 'Reserve a promotion code',
      description:
        'Resolves a code string, checks eligibility (active, remaining global uses, per-customer limit), and creates or extends a CodeReservation for the (code, cart) pair. Idempotent per (code, cart). Rate-limited inside the service layer.',
      requestBody: { contentType: 'application/json', schema: codeReserveInputSchema },
      responses: [{ status: 200, description: 'Reservation created or extended' }],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
        { status: 422, description: 'Unknown, inactive, or exhausted code; or a per-customer-limited code with no identified customer' },
      ],
    },
  },
}
