import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveOrganizationScopeFilter } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogProductTag } from '../../data/entities'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createPagedListResponseSchema } from '../openapi'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['catalog.products.view'] },
}

export const metadata = routeMetadata

const querySchema = z
  .object({
    search: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(200).default(50),
  })
  .passthrough()

type QueryShape = z.infer<typeof querySchema>

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ items: [] }, { status: 401 })

  const url = new URL(req.url)
  const parsed = querySchema.safeParse({
    search: url.searchParams.get('search') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ items: [], error: 'Invalid query' }, { status: 400 })
  }
  const query: QueryShape = parsed.data

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const { translate } = await resolveTranslations()

  const tenantId = scope?.tenantId ?? auth.tenantId ?? null
  if (!tenantId) {
    return NextResponse.json(
      { items: [], error: translate('catalog.errors.tenant_required', 'Tenant context is required.') },
      { status: 400 }
    )
  }

  // Scope by the caller's visible organizations. Under "All organizations"
  // (super-admin) `where` is empty, so the list scopes by tenant only instead
  // of 400-ing; restricted callers get their `filterIds` `$in` guard.
  const orgFilter = resolveOrganizationScopeFilter(scope, auth)

  const where: Record<string, unknown> = {
    ...orgFilter.where,
    tenantId,
  }
  const search = query.search?.trim()
  if (search) {
    where.label = { $ilike: `%${escapeLikePattern(search)}%` }
  }

  const limit = query.pageSize
  const offset = (query.page - 1) * query.pageSize
  const [records, total] = await em.findAndCount(
    CatalogProductTag,
    where,
    { limit, offset, orderBy: { label: 'asc' } }
  )

  return NextResponse.json({
    items: records.map((record) => ({
      id: record.id,
      label: record.label,
      slug: record.slug,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    })),
    total,
  })
}

const tagListItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  slug: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Product Tag management',
  methods: {
    GET: {
      summary: 'List product tags',
      description: 'Returns a paginated collection of product tags scoped to the authenticated organization.',
      query: querySchema,
      responses: [
        {
          status: 200,
          description: 'Paginated product tags',
          schema: createPagedListResponseSchema(tagListItemSchema),
        },
      ],
    },
  },
}
