import { NextResponse } from 'next/server'
import { z } from 'zod'
import { asValue } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { evaluateInputSchema } from '../../data/validators'
import type { AddFreeItemEffect, AppliedPromotion, EvaluateInput, PromotionsService, ResolvedEffect } from '../../lib/types'
import { filterProductIdsByScope, resolveBuyerAssortmentScopeOrEmpty } from '../../lib/buyer-visibility'

function isAddFreeItemEffect(effect: ResolvedEffect): effect is AddFreeItemEffect {
  return effect.type === 'ADD_FREE_ITEM'
}

const logger = createLogger('promotions')

// §Cart-Facing Endpoints `POST /api/promotions/free-products` (rev V2) — "Respects the
// caller's buyer scope exactly as `dynamic-labels` does: a reward the buyer's assortment
// would hide is never offered here either." Reuses the exact `EvaluateInput` wire shape
// (§Cart-Facing Endpoints `evaluate`'s own request body) rather than inventing a
// narrower one — the spec does not fully spell out this route's own request fields, and
// reusing `evaluate`'s already-frozen `items`/`buyer`/etc. shape is the module's own
// precedent for "do not invent a new type when an existing one already fits"
// (`lib/types.ts`'s `EvaluateItem` comment). Same standard `getAuthFromRequest(req)`
// auth model as `evaluate`.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.evaluate'] },
}

type RouteContext = {
  container: Awaited<ReturnType<typeof createRequestContainer>>
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

async function resolveRouteContext(req: Request): Promise<RouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
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
  return { container, tenantId: auth.tenantId, organizationId, translate }
}

export async function POST(req: Request) {
  try {
    const { container, tenantId, organizationId } = await resolveRouteContext(req)
    const body = await readJsonSafe(req, {})

    let input: EvaluateInput
    try {
      input = evaluateInputSchema.parse(body) as EvaluateInput
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid free-products payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    // `free_product`/`buy_x_get_y` benefits ARE resolved by `evaluate` already (Step
    // 2.3b) — reusing the full pipeline here is correct, then narrowing the response to
    // `ADD_FREE_ITEM` effects only (this route is specifically about free-item OFFERS,
    // not generic discounts).
    const result = await promotionsService.evaluate(input)

    // Flatten to (promotionId, promotionName, effect) rows first — narrowing
    // `ResolvedEffect`'s discriminated union to `AddFreeItemEffect` once here, rather than
    // re-filtering the same `effect.type === 'ADD_FREE_ITEM'` check at every later step
    // (`.filter()` alone does not narrow a consumer's element type without an explicit
    // `is` predicate).
    const freeItemRows: Array<{ promotionId: string; promotionName: string; effect: AddFreeItemEffect }> = []
    for (const applied of result.appliedPromotions) {
      for (const effect of applied.effects) {
        if (isAddFreeItemEffect(effect)) {
          freeItemRows.push({ promotionId: applied.promotionId, promotionName: applied.promotionName, effect })
        }
      }
    }

    if (freeItemRows.length === 0) return NextResponse.json({ appliedPromotions: [] as AppliedPromotion[] })

    // The caller's own `BuyerContext` is already in the request body (same field
    // `evaluate` takes) — a real per-customer scope resolution is available here, unlike
    // `dynamic-labels`/`product-page`, whose wire contracts carry no buyer identity at
    // all. A reward whose product the buyer's assortment would hide is never offered.
    const scopeResolution = await resolveBuyerAssortmentScopeOrEmpty(container, {
      customerId: input.buyer.customerId,
      customerIds: input.buyer.customerIds,
      tenantId,
    })
    if (!scopeResolution.resolved) {
      logger.warn('promotions.free-products could not resolve a buyer assortment scope; failing closed to empty list', {
        tenantId,
        organizationId,
      })
      return NextResponse.json({ appliedPromotions: [] as AppliedPromotion[] })
    }

    const rewardProductIds = Array.from(new Set(freeItemRows.map((row) => row.effect.productId)))
    const em = container.resolve<EntityManager>('em')
    const visibleProductIds = await filterProductIdsByScope(
      em,
      rewardProductIds,
      { tenantId, organizationId },
      scopeResolution.scope,
    )

    const visibleRows = freeItemRows.filter((row) => visibleProductIds.has(row.effect.productId))

    const appliedPromotions: AppliedPromotion[] = []
    const indexByPromotionId = new Map<string, number>()
    for (const row of visibleRows) {
      const existingIndex = indexByPromotionId.get(row.promotionId)
      if (existingIndex === undefined) {
        indexByPromotionId.set(row.promotionId, appliedPromotions.length)
        appliedPromotions.push({ promotionId: row.promotionId, promotionName: row.promotionName, effects: [row.effect] })
      } else {
        appliedPromotions[existingIndex].effects.push(row.effect)
      }
    }

    return NextResponse.json({ appliedPromotions })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.free-products failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.free_products_failed', 'Failed to resolve free-product offers') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Resolve free-product offers (FreeProductBenefit + BuyXGetY) for a cart context',
  methods: {
    POST: {
      summary: 'Resolve free-product offers',
      description:
        'Reuses the full evaluate() pipeline and narrows the response to ADD_FREE_ITEM effects only, scoped to the caller\'s resolved buyer assortment visibility.',
      requestBody: { contentType: 'application/json', schema: evaluateInputSchema },
      responses: [{ status: 200, description: 'Applied promotions, narrowed to ADD_FREE_ITEM effects only' }],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
