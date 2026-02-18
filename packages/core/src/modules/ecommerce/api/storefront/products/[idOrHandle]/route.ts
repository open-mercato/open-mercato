import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { resolveStoreFromRequest } from '../../../../lib/storeContext'
import { fetchStorefrontProductDetail } from '../../../../lib/storefrontDetail'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ idOrHandle: string }> },
) {
  try {
    const { idOrHandle } = await params
    if (!idOrHandle) {
      return NextResponse.json({ error: 'Product id or handle is required' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenantId') ?? null

    const storeCtx = await resolveStoreFromRequest(req, em, tenantId)
    if (!storeCtx) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const pricingService = container.resolve<CatalogPricingService>('catalogPricingService')
    const detail = await fetchStorefrontProductDetail(em, pricingService, storeCtx, idOrHandle)

    if (!detail) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    return NextResponse.json(detail)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const pricingSchema = z.object({
  currencyCode: z.string(),
  unitPriceNet: z.string().nullable(),
  unitPriceGross: z.string().nullable(),
  displayMode: z.string(),
  isPromotion: z.boolean(),
}).nullable()

const variantSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  sku: z.string().nullable(),
  optionValues: z.record(z.string(), z.string()).nullable(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  pricing: pricingSchema,
  dimensions: z.record(z.string(), z.unknown()).nullable(),
  weightValue: z.string().nullable(),
  weightUnit: z.string().nullable(),
})

const responseSchema = z.object({
  product: z.object({
    id: z.string().uuid(),
    handle: z.string().nullable(),
    title: z.string(),
    subtitle: z.string().nullable(),
    description: z.string().nullable(),
    sku: z.string().nullable(),
    productType: z.string(),
    isConfigurable: z.boolean(),
    defaultMediaUrl: z.string().nullable(),
    media: z.array(z.object({ id: z.string(), url: z.string(), alt: z.string().nullable() })),
    dimensions: z.record(z.string(), z.unknown()).nullable(),
    weightValue: z.string().nullable(),
    weightUnit: z.string().nullable(),
    categories: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string().nullable() })),
    tags: z.array(z.string()),
    optionSchema: z.object({
      name: z.string().nullable(),
      description: z.string().nullable(),
      options: z.array(z.object({
        code: z.string(),
        label: z.string(),
        inputType: z.string(),
        isRequired: z.boolean(),
        choices: z.array(z.object({ code: z.string(), label: z.string().nullable() })),
      })),
    }).nullable(),
    variants: z.array(variantSchema),
    pricing: pricingSchema,
    relatedProducts: z.array(z.object({
      id: z.string().uuid(),
      handle: z.string().nullable(),
      title: z.string(),
      defaultMediaUrl: z.string().nullable(),
      priceRange: z.object({ min: z.string(), max: z.string(), currencyCode: z.string() }).nullable(),
    })),
  }),
  effectiveLocale: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Storefront product detail',
  methods: {
    GET: {
      summary: 'Get product by id or handle',
      description:
        'Returns full product detail including variants, pricing, option schema, categories, and related products.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        locale: z.string().optional(),
      }),
      responses: [{ status: 200, description: 'Product detail', schema: responseSchema }],
      errors: [
        { status: 404, description: 'Product or store not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
