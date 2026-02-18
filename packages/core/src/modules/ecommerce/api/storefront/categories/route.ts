import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveStoreFromRequest } from '../../../lib/storeContext'
import { fetchStorefrontCategories } from '../../../lib/storefrontCategories'
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

    const categories = await fetchStorefrontCategories(em, storeCtx)
    return NextResponse.json({ categories })
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const categoryNodeSchema: z.ZodType<{
  id: string
  name: string
  slug: string | null
  description: string | null
  parentId: string | null
  depth: number
  productCount: number
  children: unknown[]
}> = z.lazy(() =>
  z.object({
    id: z.string().uuid(),
    name: z.string(),
    slug: z.string().nullable(),
    description: z.string().nullable(),
    parentId: z.string().uuid().nullable(),
    depth: z.number(),
    productCount: z.number(),
    children: z.array(categoryNodeSchema),
  }),
)

export const openApi: OpenApiRouteDoc = {
  tag: 'Ecommerce Storefront',
  summary: 'Storefront categories',
  methods: {
    GET: {
      summary: 'Get category tree',
      description:
        'Returns the full category hierarchy with product counts. Used to populate category navigation and filter menus.',
      query: z.object({
        storeSlug: z.string().optional(),
        tenantId: z.string().uuid().optional(),
        locale: z.string().optional(),
      }),
      responses: [
        {
          status: 200,
          description: 'Category tree',
          schema: z.object({ categories: z.array(categoryNodeSchema) }),
        },
      ],
      errors: [
        { status: 404, description: 'Store not found', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
