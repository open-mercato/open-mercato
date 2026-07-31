import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { CrudHttpError, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { OpenApiMethodDoc, OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CatalogProduct, CatalogProductVariant } from '../../../data/entities'
import { omnibusPreviewQuerySchema } from '../../../data/validators'
import { resolvePresentedPrice } from '../../../lib/omnibusPresentation'
import type { CatalogOmnibusService } from '../../../services/catalogOmnibusService'
import type { OmnibusResolutionContext } from '../../../lib/omnibusTypes'

const logger = createLogger('catalog')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.price_history.view'] },
}

const omnibusBlockSchema = z.object({
  presentedPriceKindId: z.string(),
  lookbackDays: z.number(),
  minimizationAxis: z.enum(['gross', 'net']),
  promotionAnchorAt: z.string().nullable(),
  windowStart: z.string(),
  windowEnd: z.string(),
  coverageStartAt: z.string().nullable(),
  lowestPriceNet: z.string().nullable(),
  lowestPriceGross: z.string().nullable(),
  previousPriceNet: z.string().nullable(),
  previousPriceGross: z.string().nullable(),
  currencyCode: z.string(),
  applicable: z.boolean(),
  applicabilityReason: z.string(),
})

async function GET(req: Request) {
  const container = await createRequestContainer()
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth?.tenantId || !auth.orgId) {
      throw new CrudHttpError(401, { error: 'Unauthorized' })
    }
    const tenantId = auth.tenantId
    const organizationId = auth.orgId

    const url = new URL(req.url)
    const parsed = omnibusPreviewQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()))
    if (!parsed.success) {
      throw new CrudHttpError(400, { error: 'Invalid query', details: parsed.error.issues })
    }
    const query = parsed.data

    const em = container.resolve('em') as EntityManager
    const omnibusService = container.resolve('catalogOmnibusService') as CatalogOmnibusService
    const scope = { tenantId, organizationId }

    // Derogation inputs live on the product, so resolve it even when the request is
    // variant-scoped; a variant inherits the product's exemption when its own flag is null.
    let productId = query.productId ?? null
    let omnibusExempt: boolean | null = null
    let firstListedAt: Date | null = null
    // Tracks whether the product row was already read via the variant, so a product whose
    // `first_listed_at` is legitimately null is not fetched a second time.
    let productResolved = false

    if (query.variantId) {
      const variant = await findOneWithDecryption(
        em,
        CatalogProductVariant,
        { id: query.variantId, tenantId, organizationId },
        { populate: ['product'] },
        scope,
      )
      if (variant) {
        omnibusExempt = variant.omnibusExempt ?? null
        const variantProduct = variant.product
        if (variantProduct && typeof variantProduct !== 'string') {
          productId = variantProduct.id
          if (omnibusExempt === null) omnibusExempt = variantProduct.omnibusExempt ?? null
          // EC-19: a null `first_listed_at` (every row predating the omnibus migration) means
          // "not a new arrival" — it MUST NOT fall back to `created_at`. Doing so shortens the
          // window, raises the reference and overstates the reduction, and it would make this
          // preview disagree with the authoritative products-list path, which reads the column
          // verbatim. New rows default the column to `created_at` at creation time instead.
          firstListedAt = variantProduct.firstListedAt ?? null
          productResolved = true
        }
      }
    }

    if (productId && !productResolved) {
      const product = await findOneWithDecryption(
        em,
        CatalogProduct,
        { id: productId, tenantId, organizationId },
        undefined,
        scope,
      )
      if (product) {
        if (omnibusExempt === null) omnibusExempt = product.omnibusExempt ?? null
        firstListedAt = product.firstListedAt ?? null
      }
    }

    const ctx: OmnibusResolutionContext = {
      tenantId,
      organizationId,
      productId,
      variantId: query.variantId ?? null,
      offerId: query.offerId ?? null,
      priceKindId: query.priceKindId,
      currencyCode: query.currencyCode,
      channelId: query.channelId ?? null,
      isStorefront: false,
      firstListedAt,
      omnibusExempt,
    }

    // Deriving the presented entry here (rather than passing null) is what makes the admin
    // preview agree with the authoritative products-list result: same anchor, same EC-7
    // exclusion, same applicability decision.
    const config = await omnibusService.getConfig(scope)
    const presented = await resolvePresentedPrice(em, ctx, config)
    const block = await omnibusService.resolveOmnibusBlock(
      em,
      ctx,
      presented.presentedEntry,
      presented.priceKindIsPromotion,
    )

    return NextResponse.json(block)
  } catch (err) {
    if (isCrudHttpError(err)) {
      return NextResponse.json(err.body, { status: err.status })
    }
    logger.error('catalog.prices.omnibus-preview.GET Unexpected error', { err })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const getDoc: OpenApiMethodDoc = {
  summary: 'Preview the Omnibus reference price for a pricing scope',
  description:
    'Resolves the EU Omnibus prior reference price (lowest price in the lookback window) for a product, variant or offer. Returns null when Omnibus is disabled for the tenant.',
  tags: ['Catalog'],
  query: omnibusPreviewQuerySchema,
  responses: [
    { status: 200, description: 'Omnibus block, or null when disabled', schema: omnibusBlockSchema.nullable() },
  ],
  errors: [
    { status: 400, description: 'Invalid query parameters' },
    { status: 401, description: 'Unauthorized' },
  ],
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Omnibus reference price preview',
  methods: { GET: getDoc },
}

export { GET }
