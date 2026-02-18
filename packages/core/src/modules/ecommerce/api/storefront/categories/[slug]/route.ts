import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CatalogPricingService } from '@open-mercato/core/modules/catalog/services/catalogPricingService'
import { resolveStoreFromRequest } from '../../../../lib/storeContext'
import { fetchStorefrontCategoryBySlug } from '../../../../lib/storefrontCategories'
import { fetchStorefrontProducts } from '../../../../lib/storefrontProducts'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params
    if (!slug) {
      return NextResponse.json({ error: 'Category slug is required' }, { status: 400 })
    }

    const container = await createRequestContainer()
    const em = container.resolve('em') as EntityManager
    const url = new URL(req.url)
    const tenantId = url.searchParams.get('tenantId') ?? ''

    const storeCtx = await resolveStoreFromRequest(req, em, tenantId)
    if (!storeCtx) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const category = await fetchStorefrontCategoryBySlug(em, storeCtx, slug)
    if (!category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 })
    }

    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '24', 10) || 24))
    const search = url.searchParams.get('search') ?? null
    const sort = url.searchParams.get('sort') ?? null
    const tagIdsRaw = url.searchParams.get('tagIds')
    const tagIds = tagIdsRaw ? tagIdsRaw.split(',').map((s) => s.trim()).filter(Boolean) : null

    const pricingService = container.resolve<CatalogPricingService>('catalogPricingService')
    const products = await fetchStorefrontProducts(em, pricingService, storeCtx, {
      page,
      pageSize,
      search,
      categoryId: category.id,
      tagIds,
      sort,
    })

    return NextResponse.json({ category, products })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Storefront category detail',
  methods: {
    GET: {
      summary: 'Get category with products',
      description:
        'Returns category detail and a paginated product listing pre-filtered by the category (including subcategories).',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        locale: z.string().optional(),
        page: z.coerce.number().min(1).optional(),
        pageSize: z.coerce.number().min(1).max(100).optional(),
        search: z.string().optional(),
        tagIds: z.string().optional(),
        sort: z.enum(['title_asc', 'title_desc', 'price_asc', 'price_desc', 'newest']).optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'Category detail with products',
          schema: z.object({
            category: z.object({
              id: z.string().uuid(),
              name: z.string(),
              slug: z.string().nullable(),
              description: z.string().nullable(),
              parentId: z.string().uuid().nullable(),
              depth: z.number(),
              productCount: z.number(),
              ancestorIds: z.array(z.string()),
              childIds: z.array(z.string()),
            }),
            products: z.object({
              items: z.array(z.record(z.string(), z.unknown())),
              total: z.number(),
              page: z.number(),
              pageSize: z.number(),
              totalPages: z.number(),
              effectiveLocale: z.string(),
              filters: z.record(z.string(), z.unknown()),
            }),
          }),
        },
      ],
      errors: [
        { status: 404, description: 'Store or category not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
