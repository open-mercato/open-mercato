import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { resolveStoreFromRequest } from '../../../lib/storeContext'
import { fetchStorefrontProducts } from '../../../lib/storefrontProducts'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(req: Request) {
  try {
    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenantId') ?? ''

    const storeCtx = await resolveStoreFromRequest(req, em, tenantId)
    if (!storeCtx) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '24', 10) || 24))
    const search = url.searchParams.get('search') ?? null
    const categoryId = url.searchParams.get('categoryId') ?? null
    const tagIdsRaw = url.searchParams.get('tagIds')
    const tagIds = tagIdsRaw ? tagIdsRaw.split(',').map((s) => s.trim()).filter(Boolean) : null
    const priceMinRaw = url.searchParams.get('priceMin')
    const priceMaxRaw = url.searchParams.get('priceMax')
    const priceMin = priceMinRaw ? parseFloat(priceMinRaw) : null
    const priceMax = priceMaxRaw ? parseFloat(priceMaxRaw) : null
    const sort = url.searchParams.get('sort') ?? null

    const pricingService = container.resolve<CatalogPricingService>('catalogPricingService')

    const result = await fetchStorefrontProducts(em, pricingService, storeCtx, {
      page,
      pageSize,
      search,
      categoryId,
      tagIds,
      priceMin: priceMin != null && !isNaN(priceMin) ? priceMin : null,
      priceMax: priceMax != null && !isNaN(priceMax) ? priceMax : null,
      sort,
    })

    return NextResponse.json(result)
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const productItemSchema = z.object({
  id: z.string().uuid(),
  handle: z.string().nullable(),
  title: z.string(),
  subtitle: z.string().nullable(),
  defaultMediaUrl: z.string().nullable(),
  productType: z.string(),
  isConfigurable: z.boolean(),
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string().nullable() })),
  tags: z.array(z.string()),
  priceRange: z.object({ min: z.string(), max: z.string(), currencyCode: z.string() }).nullable(),
  hasVariants: z.boolean(),
  variantCount: z.number(),
})

const facetsSchema = z.object({
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string().nullable(), count: z.number() })),
  tags: z.array(z.object({ slug: z.string(), label: z.string(), count: z.number() })),
  priceRange: z.object({ min: z.number(), max: z.number(), currencyCode: z.string() }).nullable(),
  options: z.array(z.object({
    code: z.string(),
    label: z.string(),
    values: z.array(z.object({ code: z.string(), label: z.string(), count: z.number() })),
  })),
})

const responseSchema = z.object({
  items: z.array(productItemSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
  totalPages: z.number(),
  effectiveLocale: z.string(),
  filters: facetsSchema,
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Storefront products',
  methods: {
    GET: {
      summary: 'List storefront products',
      description:
        'Returns paginated products for the storefront with pricing, facets, and localization. Store is resolved from the Host header or storeSlug query parameter.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        locale: z.string().optional(),
        page: z.coerce.number().min(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).optional(),
        search: z.string().optional(),
        categoryId: z.string().uuid().optional(),
        tagIds: z.string().optional(),
        priceMin: z.coerce.number().optional(),
        priceMax: z.coerce.number().optional(),
        sort: z.enum(['title_asc', 'title_desc', 'price_asc', 'price_desc', 'newest']).optional(),
      }),
      responses: [{ status: 200, description: 'Product list with facets', schema: responseSchema }],
      errors: [
        { status: 404, description: 'Store not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
