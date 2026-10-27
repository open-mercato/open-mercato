import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { listProductsForCategory, listUnitCategories } from '../../lib/productUse'
import { handleRouteError, resolveStaffContext } from '../routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['property_management.view'] },
}

const querySchema = z.object({ categoryId: z.string().uuid().optional() })

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
})

export async function GET(req: Request) {
  try {
    const context = await resolveStaffContext(req)
    const url = new URL(req.url)
    const query = querySchema.parse({ categoryId: url.searchParams.get('categoryId') ?? undefined })
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const [categories, products] = await Promise.all([
      listUnitCategories(context.em, scope),
      query.categoryId ? listProductsForCategory(context.em, scope, query.categoryId) : Promise.resolve([]),
    ])
    return NextResponse.json({ categories, products })
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
      description: 'Products of the category and its descendants, with their leasable/bookable use.',
      query: querySchema,
      responses: [{ status: 200, description: 'Options', schema: responseSchema }],
    },
  },
}
