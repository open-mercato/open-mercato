import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata: { path?: string } = {}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.view'], { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '50', 10) || 50))
  const search = (url.searchParams.get('search') || '').trim()

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedAt: null,
  }

  if (search) {
    const escapedSearch = search.replace(/[%_\\]/g, '\\$&')
    where.$or = [
      { name: { $ilike: `%${escapedSearch}%` } },
      { slug: { $ilike: `%${escapedSearch}%` } },
    ]
  }

  const offset = (page - 1) * pageSize
  const [paged, total] = await em.findAndCount(CustomerRole, where as any, {
    orderBy: { createdAt: 'ASC' },
    limit: pageSize,
    offset,
  })

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  const items = paged.map((role) => ({
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description || null,
    isDefault: role.isDefault,
    isSystem: role.isSystem,
    customerAssignable: role.customerAssignable,
    createdAt: role.createdAt,
  }))

  return NextResponse.json({ ok: true, items, total, totalPages, page })
}

const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  customerAssignable: z.boolean(),
  createdAt: z.string().datetime(),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'List customer roles (admin)',
  description: 'Returns all customer roles for the tenant.',
  tags: ['Customer Accounts Admin'],
  responses: [{
    status: 200,
    description: 'Role list',
    schema: z.object({ ok: z.literal(true), items: z.array(roleSchema), total: z.number(), totalPages: z.number(), page: z.number() }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List customer roles (admin)',
  methods: { GET: methodDoc },
}

export default GET
