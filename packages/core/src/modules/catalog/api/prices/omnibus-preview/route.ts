import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import {
  CatalogOffer,
  CatalogPriceKind,
  CatalogProduct,
  CatalogProductPrice,
  CatalogProductVariant,
} from '../../../data/entities'
import { omnibusPreviewQuerySchema } from '../../../data/validators'
import { omnibusBlockSchema } from '../../../lib/omnibusTypes'
import { resolveOmnibusPresentedEntries } from '../../../lib/omnibusPresentedEntry'
import { resolvePriceHistoryOrganizationIds } from '../../../lib/priceHistoryQuery'
import { resolvePriceVariantId, selectBestPrice, type PriceRow } from '../../../lib/pricing'
import type { CatalogOmnibusService } from '../../../services/catalogOmnibusService'

const logger = createLogger('catalog')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.price_history.view'] },
}

const NOT_FOUND = { error: 'Not found' }

function relationId(value: { id: string } | string | null | undefined): string | null {
  if (!value) return null
  return typeof value === 'string' ? value : value.id
}

export async function GET(req: Request) {
  try {
    const auth = await getAuthFromRequest(req)
    if (!auth || !auth.tenantId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const parsed = omnibusPreviewQuerySchema.safeParse(Object.fromEntries(url.searchParams))
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid query', details: z.flattenError(parsed.error) },
        { status: 400 },
      )
    }
    const query = parsed.data

    const container = await createRequestContainer()
    const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
    const tenantId = scope.tenantId ?? auth.tenantId
    const organizationIds = resolvePriceHistoryOrganizationIds(scope, auth.orgId)
    if (organizationIds !== null && organizationIds.length === 0) {
      return NextResponse.json(NOT_FOUND, { status: 404 })
    }
    const organizationFilter = organizationIds === null ? {} : { organizationId: { $in: organizationIds } }
    const decryptionScope = { tenantId, organizationId: scope.selectedId ?? auth.orgId ?? null }
    const em = (container.resolve('em') as EntityManager).fork()

    const offer = query.offerId
      ? await findOneWithDecryption(
          em,
          CatalogOffer,
          { id: query.offerId, tenantId, deletedAt: null, ...organizationFilter },
          undefined,
          decryptionScope,
        )
      : null
    if (query.offerId && !offer) return NextResponse.json(NOT_FOUND, { status: 404 })
    const variant = query.variantId
      ? await findOneWithDecryption(
          em,
          CatalogProductVariant,
          { id: query.variantId, tenantId, deletedAt: null, ...organizationFilter },
          undefined,
          decryptionScope,
        )
      : null
    if (query.variantId && !variant) return NextResponse.json(NOT_FOUND, { status: 404 })

    const productIds = new Set(
      [query.productId ?? null, relationId(offer?.product), relationId(variant?.product)].filter(
        (id): id is string => typeof id === 'string',
      ),
    )
    if (productIds.size !== 1) return NextResponse.json(NOT_FOUND, { status: 404 })
    const [productId] = Array.from(productIds)
    const product = await findOneWithDecryption(
      em,
      CatalogProduct,
      { id: productId, tenantId, deletedAt: null, ...organizationFilter },
      undefined,
      decryptionScope,
    )
    if (!product) return NextResponse.json(NOT_FOUND, { status: 404 })
    const organizationId = product.organizationId
    const productScope = { tenantId, organizationId }

    const priceKind = await findOneWithDecryption(
      em,
      CatalogPriceKind,
      {
        id: query.priceKindId,
        tenantId,
        deletedAt: null,
        $or: [{ organizationId }, { organizationId: null }],
      },
      undefined,
      productScope,
    )
    if (!priceKind) return NextResponse.json(NOT_FOUND, { status: 404 })

    const priceRows = await findWithDecryption<CatalogProductPrice>(
      em,
      CatalogProductPrice,
      {
        tenantId,
        organizationId,
        priceKind: query.priceKindId,
        currencyCode: query.currencyCode,
        $or: [{ product: productId }, ...(query.variantId ? [{ variant: query.variantId }] : [])],
      },
      { populate: ['offer', 'variant', 'product', 'priceKind'] },
      productScope,
    )
    const scopedRows = (priceRows as PriceRow[]).filter((row) => {
      const rowVariantId = resolvePriceVariantId(row)
      return !query.variantId || !rowVariantId || rowVariantId === query.variantId
    })
    const presentedPrice = selectBestPrice(scopedRows, {
      channelId: query.channelId ?? null,
      offerId: query.offerId ?? null,
      priceKindId: query.priceKindId,
      currencyCode: query.currencyCode,
      quantity: 1,
      date: new Date(),
    })
    const presentedEntries = presentedPrice
      ? await resolveOmnibusPresentedEntries(em, [presentedPrice])
      : new Map()

    const service = container.resolve('catalogOmnibusService') as CatalogOmnibusService
    const block = await service.resolveOmnibusBlock(
      em,
      {
        tenantId,
        organizationId,
        productId,
        variantId: query.variantId ?? null,
        offerId: query.offerId ?? null,
        channelId: query.channelId ?? null,
        priceKindId: query.priceKindId,
        currencyCode: query.currencyCode,
        isStorefront: false,
      },
      presentedPrice ? presentedEntries.get(presentedPrice.id) ?? null : null,
      priceKind.isPromotion === true,
    )
    return NextResponse.json(block)
  } catch (err) {
    logger.error('catalog.prices.omnibus-preview.GET Unexpected error', { err })
    getTelemetryRuntime()?.reportError(err, {
      module: 'catalog',
      code: 'catalog.omnibus_preview_failed',
    })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const errorSchema = z.object({ error: z.string() })

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Catalog Omnibus reference-price preview',
  methods: {
    GET: {
      summary: 'Preview the Omnibus reference-price block',
      description:
        'Resolves the EU Omnibus reference-price block for one product, variant or offer and price kind, using the current active price of that kind as the presented entry. Returns null when Omnibus is disabled for the tenant. Monetary values are fixed 4-decimal strings.',
      query: omnibusPreviewQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Omnibus block, or null when Omnibus is disabled',
          schema: omnibusBlockSchema.nullable(),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid query', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing catalog.price_history.view', schema: errorSchema },
        { status: 404, description: 'Product, variant, offer or price kind not found in scope', schema: errorSchema },
      ],
    },
  },
}
