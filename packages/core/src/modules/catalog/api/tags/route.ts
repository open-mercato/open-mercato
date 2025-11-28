import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CatalogProductTag } from '../../data/entities'

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

  const allowed = scope?.filterIds ?? scope?.allowedIds ?? (auth.orgId ? [auth.orgId] : null)
  const preferredOrg = scope?.selectedId ?? auth.orgId ?? null
  const organizationId = preferredOrg ?? (Array.isArray(allowed) && allowed.length ? allowed[0]! : null)
  if (!organizationId || (Array.isArray(allowed) && allowed.length && !allowed.includes(organizationId))) {
    return NextResponse.json(
      { items: [], error: translate('catalog.errors.organization_required', 'Organization context is required.') },
      { status: 400 }
    )
  }

  const where: Record<string, unknown> = {
    organizationId,
    tenantId,
  }
  const search = query.search?.trim()
  if (search) {
    where.label = { $ilike: `%${search}%` }
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

const tagItemSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  slug: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

const tagListResponseSchema = z.object({
  items: z.array(tagItemSchema),
  total: z.number(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Catalog',
  summary: 'Product tags',
  methods: {
    GET: {
      summary: 'List tags',
      description: 'Returns catalog tags scoped to the authenticated organization.',
      query: querySchema,
      responses: [{ status: 200, description: 'Tag list', schema: tagListResponseSchema }],
    },
  },
}
