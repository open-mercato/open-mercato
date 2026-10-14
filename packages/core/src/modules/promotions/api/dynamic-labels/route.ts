import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { PromotionCacheService } from '../../services/promotion-cache'
import type { NormalizedPromotion, NormalizedRule, NormalizedRuleGroup } from '../../lib/types'
import { isPromotionVisibleInScope, resolveBuyerAssortmentScopeOrEmpty } from '../../lib/buyer-visibility'

const logger = createLogger('promotions')

// §Cart-Facing Endpoints `GET /api/promotions/dynamic-labels` (rev V2) — "Returns only
// promotions whose scope the caller's own buyer context can see ... there is no
// anonymous, scope-free variant". Same standard `getAuthFromRequest(req)` auth model as
// `evaluate`.
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['promotions.evaluate'] },
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
  return { container, tenantId: auth.tenantId, organizationId, translate }
}

type DynamicLabelSummary = { promotionId: string; promotionName: string; tags: string[]; conditions: NormalizedRule[] }

function flattenRules(group: NormalizedRuleGroup, into: NormalizedRule[]): void {
  into.push(...group.rules)
  for (const child of group.children) flattenRules(child, into)
}

function toSummary(promotion: NormalizedPromotion): DynamicLabelSummary {
  const conditions: NormalizedRule[] = []
  flattenRules(promotion.rootGroup, conditions)
  return { promotionId: promotion.id, promotionName: promotion.name, tags: promotion.tags, conditions }
}

export async function GET(req: Request) {
  try {
    const { container, tenantId, organizationId } = await resolveRouteContext(req)

    const promotionCacheService = container.resolve<PromotionCacheService>('promotionCacheService')
    const promotions = await promotionCacheService.getActivePromotions(tenantId, organizationId)

    // The request carries no buyer identity at all (`GET`, no body) — per spec this
    // route has "no anonymous, scope-free variant", so the narrowest correct resolution
    // is the tenant's own ANONYMOUS/default-group assortment scope, not an unscoped
    // bypass. A genuinely unresolvable scope (the `customer_groups` service missing or
    // throwing) fails closed to an empty list, never an unscoped one.
    const scopeResolution = await resolveBuyerAssortmentScopeOrEmpty(container, {
      customerId: null,
      customerIds: [],
      tenantId,
    })
    if (!scopeResolution.resolved) {
      logger.warn('promotions.dynamic-labels could not resolve a buyer assortment scope; failing closed to empty list', {
        tenantId,
        organizationId,
      })
      return NextResponse.json({ promotions: [] as DynamicLabelSummary[] })
    }

    const visible = promotions.filter((promotion) => isPromotionVisibleInScope(promotion, scopeResolution.scope))
    return NextResponse.json({ promotions: visible.map(toSummary) })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.dynamic-labels failed', { err })
    return NextResponse.json(
      { error: translate('promotions.errors.dynamic_labels_failed', 'Failed to resolve dynamic labels') },
      { status: 400 },
    )
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'List simplified promotion condition summaries for storefront label rendering',
  methods: {
    GET: {
      summary: 'List visible promotion condition summaries',
      description:
        'Simplified promotion summaries (name, tags, flattened rule conditions) for storefront label rendering, scoped to the caller\'s resolved buyer assortment visibility. No anonymous, scope-free variant.',
      responses: [{ status: 200, description: 'Visible promotion condition summaries' }],
      errors: [
        { status: 400, description: 'Missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
