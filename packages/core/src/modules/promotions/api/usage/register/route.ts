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
import { registerUsageInputSchema } from '../../../data/validators'
import type { PromotionsService, RegisterUsageInput, ResolvedEffect } from '../../../lib/types'

const logger = createLogger('promotions')

// SPEC-055 §Cart-Facing Endpoints `POST /api/promotions/usage/register` (Release 4
// PLAN.md Step 6.7) — thin HTTP adapter over `promotionsService.registerUsage()` (Step
// 6.3). Called by the cart integration after an order/quote is confirmed; `cart`'s own
// in-process caller never goes through this route (§Amendment A.2) — this is the
// genuinely-external-cart door. `registerUsageInputSchema` validates only the structural
// shape of `appliedPromotions[].effects` (a jsonb snapshot, not a discriminated-union
// parse) — this route is now the first genuine untrusted-wire boundary for that shape
// (`commands/usage.ts`'s own comment on this cast predates this route existing).
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.usage.manage'] },
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
  container.register({ auth: asValue({ ...auth, orgId: organizationId }) })
  return { container, userId: auth.sub, tenantId: auth.tenantId, organizationId, translate }
}

export async function POST(req: Request) {
  try {
    const { container, userId, tenantId, organizationId } = await resolveRouteContext(req)
    const body = await readJsonSafe(req, {})

    let input: RegisterUsageInput
    try {
      const parsed = registerUsageInputSchema.parse(body)
      input = {
        orderId: parsed.orderId,
        orderType: parsed.orderType,
        customerId: parsed.customerId,
        currency: parsed.currency,
        appliedPromotions: parsed.appliedPromotions.map((applied) => ({
          promotionId: applied.promotionId,
          promotionName: applied.promotionName,
          effects: applied.effects as unknown as ResolvedEffect[],
        })),
      }
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid usage/register payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    // State-changing action endpoint — the mutation's own parent aggregate is the
    // `Promotion` row(s) `registerUsage` locks (§Promotion Usage Lifecycle), not any
    // single `PromotionUsage` ledger row; the request processes a whole batch
    // (`appliedPromotions[]`), so there is no single resource id to report.
    const guarded = await runRouteMutationGuards({
      container,
      req,
      auth: { userId, tenantId, organizationId },
      input: { resourceKind: 'promotions.promotion', resourceId: null, operation: 'create', mutationPayload: body as Record<string, unknown> },
    })
    if (!guarded.ok) return guarded.response

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const result = await promotionsService.registerUsage(input)

    await guarded.runAfterSuccess()

    // §Cart-Facing Endpoints `usage/register`: "If any promotion's budget would be
    // exceeded ... the endpoint returns 207 Multi-Status with a budgetExceeded flag" —
    // same `{ ok: true, budgetExceeded }` response body either way; only the status code
    // changes. Release 4 PLAN.md Step 6.3's own "207 Multi-Status" framing names exactly
    // this route as the place that gap closes.
    const status = result.budgetExceeded.length > 0 ? 207 : 200
    return NextResponse.json(result, { status })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.usage.register failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.usage_register_failed', 'Failed to register promotion usage') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Register discount usage for a confirmed order/quote, enforcing lifetime budgets',
  methods: {
    POST: {
      summary: 'Register promotion usage',
      description:
        'Idempotent on re-submission for the same orderId. For each appliedPromotion, locks the promotion row, re-reads the lifetime budget, and writes a PromotionUsage ledger row. Returns 207 Multi-Status (same body shape) when any promotion in the batch exceeded its budget, 200 otherwise.',
      requestBody: { contentType: 'application/json', schema: registerUsageInputSchema },
      responses: [
        { status: 200, description: 'Usage registered for every promotion in the batch' },
        { status: 207, description: 'Usage registered; one or more promotions exceeded their budget (see budgetExceeded)' },
      ],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
