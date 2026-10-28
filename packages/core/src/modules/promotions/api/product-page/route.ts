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
import { resolveProductBySkuOrExternalId } from '@open-mercato/core/modules/catalog/lib/productResolution'
import { productPageRequestSchema } from '../../data/validators'
import type { BuyerContext, PromotionsService } from '../../lib/types'
import { filterProductIdsByScope, resolveBuyerAssortmentScopeOrEmpty } from '../../lib/buyer-visibility'

const logger = createLogger('promotions')

// §Cart-Facing Endpoints `POST /api/promotions/product-page` (rev V2) — the one route
// in this module that keeps SKU addressing, "because a listing/PDP context has no cart
// line identity to carry". Same standard `getAuthFromRequest(req)` auth model as
// `evaluate`.
export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['promotions.evaluate'] },
}

// The wire contract (`{ skus: string[] }`, §Cart-Facing Endpoints line ~904) carries no
// buyer identity at all — no `customerId`, no `customerGroupIds`. A listing/PDP badge
// check therefore resolves against the ANONYMOUS buyer identity: the tenant's
// default-group assortment scope, not a per-customer one. This is a documented,
// narrowest-correct choice (§Cart-Facing Endpoints' own "fail closed" convention would
// otherwise force an empty badge list for every request, which is strictly worse): a
// future contract revision adding a buyer field to this route would let a later step
// resolve a real per-customer scope instead.
const ANONYMOUS_BUYER: BuyerContext = { customerId: null, customerIds: [], customerGroupIds: [] }

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

type Badge = { sku: string; promotionId: string; promotionName: string; label: Record<string, string> }

export async function POST(req: Request) {
  try {
    const { container, tenantId, organizationId } = await resolveRouteContext(req)
    const body = await readJsonSafe(req, {})

    let input: { skus: string[] }
    try {
      input = productPageRequestSchema.parse(body)
    } catch (err) {
      if (err instanceof z.ZodError) {
        return NextResponse.json({ error: '[internal] invalid product-page payload', issues: err.issues }, { status: 400 })
      }
      throw err
    }

    const em = container.resolve<EntityManager>('em')
    const uniqueSkus = Array.from(new Set(input.skus))

    // `resolveProductBySkuOrExternalId` resolves only `CatalogProduct.sku` (not variant
    // SKUs — `CatalogProductVariant` has its own, separate `sku` column with no lookup
    // helper of its own); there is no other existing resolution helper to call, so a SKU
    // that only matches at variant level resolves to no badge rather than guessing.
    // Unknown SKUs resolve to `null` and are silently skipped (not a 500/throw).
    const resolutions = await Promise.all(
      uniqueSkus.map(async (sku) => {
        const product = await resolveProductBySkuOrExternalId(em, { sku }, { organizationId, tenantId })
        return { sku, productId: product?.id ?? null }
      }),
    )
    const skuByProductId = new Map<string, string[]>()
    for (const { sku, productId } of resolutions) {
      if (!productId) continue
      const existing = skuByProductId.get(productId)
      if (existing) existing.push(sku)
      else skuByProductId.set(productId, [sku])
    }

    const candidateProductIds = Array.from(skuByProductId.keys())
    if (candidateProductIds.length === 0) return NextResponse.json({ badges: [] as Badge[] })

    // §Cart-Facing Endpoints (rev V2): "an authenticated caller's resolved buyer scope
    // filters which SKUs can return a badge at all." Fails closed to an empty badge list
    // when the scope genuinely cannot be resolved — never falls back to unscoped.
    const scopeResolution = await resolveBuyerAssortmentScopeOrEmpty(container, {
      customerId: ANONYMOUS_BUYER.customerId,
      customerIds: ANONYMOUS_BUYER.customerIds,
      tenantId,
    })
    if (!scopeResolution.resolved) {
      logger.warn('promotions.product-page could not resolve a buyer assortment scope; failing closed to no badges', {
        tenantId,
        organizationId,
      })
      return NextResponse.json({ badges: [] as Badge[] })
    }

    const visibleProductIds = await filterProductIdsByScope(
      em,
      candidateProductIds,
      { tenantId, organizationId },
      scopeResolution.scope,
    )

    const promotionsService = container.resolve<PromotionsService>('promotionsService')
    const evaluatedAt = new Date().toISOString() // Deliberate, narrow exception to "never
    // read the system clock in the evaluation pipeline": this route has no caller-supplied
    // cart context to carry a timestamp on (§Cart-Facing Endpoints' request body is
    // `{ skus: string[] }` only), unlike `evaluate`, which always takes `evaluatedAt` from
    // the caller. The clock read happens here, in the route, never inside `lib/`.

    const badges: Badge[] = []
    for (const productId of visibleProductIds) {
      const skus = skuByProductId.get(productId) ?? []
      if (skus.length === 0) continue
      const result = await promotionsService.evaluateForProduct({
        productId,
        variantId: null,
        buyer: ANONYMOUS_BUYER,
        evaluatedAt,
      })
      for (const sku of skus) {
        for (const badge of result.badges) {
          badges.push({ sku, promotionId: badge.promotionId, promotionName: badge.promotionName, label: badge.label })
        }
      }
    }

    return NextResponse.json({ badges })
  } catch (err) {
    const { translate } = await resolveTranslations()
    if (isCrudHttpError(err)) return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: translate('promotions.errors.invalidInput', 'Invalid input'), issues: err.issues }, { status: 400 })
    }
    logger.error('promotions.product-page failed', { err })
    return NextResponse.json({ error: translate('promotions.errors.product_page_failed', 'Failed to resolve product-page badges') }, { status: 400 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Promotions',
  summary: 'Resolve product-badge promotions for a list of SKUs',
  methods: {
    POST: {
      summary: 'Resolve listing/PDP promotion badges for SKUs',
      description:
        'Zero-DB-access-beyond-SKU-resolution lookup against the active promotion cache. An unknown SKU resolves to no badge, never an error. Scoped by the caller\'s resolved buyer assortment visibility.',
      requestBody: { contentType: 'application/json', schema: productPageRequestSchema },
      responses: [{ status: 200, description: 'Badges for SKUs with a matching active promotion' }],
      errors: [
        { status: 400, description: 'Invalid request body or missing organization scope' },
        { status: 401, description: 'Unauthorized' },
      ],
    },
  },
}
