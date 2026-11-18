import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CATALOG_OPTIONS_LIMIT, listProductsForCategory, listUnitCategories } from '../../lib/productUse'
import { handleRouteError, resolveStaffContext } from '../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

const querySchema = z.object({
  categoryId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  search: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(CATALOG_OPTIONS_LIMIT).default(CATALOG_OPTIONS_LIMIT),
})

const responseSchema = z.object({
  categories: z.array(z.object({ id: z.string().uuid(), name: z.string(), depth: z.number().int(), parentId: z.string().uuid().nullable() })),
  products: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      use: z.enum(['leasable', 'bookable']).nullable(),
      billingUnit: z.enum(['month', 'hour', 'day']).nullable(),
    }),
  ),
  hasMoreCategories: z.boolean(),
  hasMoreProducts: z.boolean(),
})

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const url = new URL(req.url)
    const query = querySchema.parse({
      categoryId: url.searchParams.get('categoryId') ?? undefined,
      productId: url.searchParams.get('productId') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
    })
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const [categoryPage, productPage] = await Promise.all([
      listUnitCategories(context.em, scope, { limit: query.limit, includeCategoryId: query.categoryId ?? null }),
      query.categoryId
        ? listProductsForCategory(context.em, scope, query.categoryId, { search: query.search, limit: query.limit, includeProductId: query.productId ?? null })
        : Promise.resolve({ products: [], hasMore: false }),
    ])
    return NextResponse.json({
      categories: categoryPage.categories,
      products: productPage.products,
      hasMoreCategories: categoryPage.hasMore,
      hasMoreProducts: productPage.hasMore,
    })
  } catch (err) {
    return handleRouteError(err, 'property_management.catalog_options_failed')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Property Management',
  summary: 'Unit types and products',
  methods: {
    GET: {
      summary: 'Catalog categories (unit types) and the products eligible for one of them',
      description:
        'Up to `limit` (≤ 100) categories in tree order, and up to `limit` products of the category and its descendants matching `search`, with their leasable/bookable use. `productId` and `categoryId` are always included when eligible, so a form can show its current value.',
      query: querySchema,
      responses: [{ status: 200, description: 'Options', schema: responseSchema }],
    },
  },
}
