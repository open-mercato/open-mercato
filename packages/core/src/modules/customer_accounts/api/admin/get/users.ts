import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUser, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata = {}

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

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25')))
  const status = url.searchParams.get('status') as 'active' | 'inactive' | 'locked' | null
  const customerEntityId = url.searchParams.get('customerEntityId')
  const roleId = url.searchParams.get('roleId')
  const search = url.searchParams.get('search')

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    deletedAt: null,
  }

  if (status === 'active') {
    where.isActive = true
    where.$or = [{ lockedUntil: null }, { lockedUntil: { $lt: new Date() } }]
  } else if (status === 'inactive') {
    where.isActive = false
  } else if (status === 'locked') {
    where.lockedUntil = { $gt: new Date() }
  }

  if (customerEntityId) {
    where.customerEntityId = customerEntityId
  }

  if (search) {
    const searchFilter = [
      { email: { $ilike: `%${search}%` } },
      { displayName: { $ilike: `%${search}%` } },
    ]
    if (where.$or) {
      where.$and = [{ $or: where.$or }, { $or: searchFilter }]
      delete where.$or
    } else {
      where.$or = searchFilter
    }
  }

  let userIds: string[] | null = null
  if (roleId) {
    const roleLinks = await em.find(CustomerUserRole, {
      role: roleId as any,
      deletedAt: null,
    })
    userIds = roleLinks.map((link) => (link.user as any)?.id || (link.user as unknown as string))
    if (userIds.length === 0) {
      return NextResponse.json({
        ok: true,
        users: [],
        pagination: { page, pageSize, total: 0, totalPages: 0 },
      })
    }
    where.id = { $in: userIds }
  }

  const offset = (page - 1) * pageSize
  const [users, total] = await em.findAndCount(CustomerUser, where as any, {
    orderBy: { createdAt: 'DESC' },
    limit: pageSize,
    offset,
  })

  const items = await Promise.all(users.map(async (user) => {
    const userRoles = await em.find(CustomerUserRole, {
      user: user.id as any,
      deletedAt: null,
    }, { populate: ['role'] })
    const roles = userRoles.map((ur) => ({
      id: (ur.role as any).id,
      name: (ur.role as any).name,
      slug: (ur.role as any).slug,
    }))

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: !!user.emailVerifiedAt,
      isActive: user.isActive,
      lockedUntil: user.lockedUntil || null,
      lastLoginAt: user.lastLoginAt || null,
      customerEntityId: user.customerEntityId || null,
      personEntityId: user.personEntityId || null,
      createdAt: user.createdAt,
      roles,
    }
  }))

  return NextResponse.json({
    ok: true,
    users: items,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  })
}

const roleSchema = z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })
const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  isActive: z.boolean(),
  lockedUntil: z.string().datetime().nullable(),
  lastLoginAt: z.string().datetime().nullable(),
  customerEntityId: z.string().uuid().nullable(),
  personEntityId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  roles: z.array(roleSchema),
})

const paginationSchema = z.object({
  page: z.number(),
  pageSize: z.number(),
  total: z.number(),
  totalPages: z.number(),
})

const methodDoc: OpenApiMethodDoc = {
  summary: 'List customer users (admin)',
  description: 'Returns a paginated list of customer users with roles. Supports filtering by status, company, role, and search.',
  tags: ['Customer Accounts Admin'],
  query: z.object({
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
    status: z.enum(['active', 'inactive', 'locked']).optional(),
    customerEntityId: z.string().uuid().optional(),
    roleId: z.string().uuid().optional(),
    search: z.string().optional(),
  }),
  responses: [{
    status: 200,
    description: 'Paginated user list',
    schema: z.object({ ok: z.literal(true), users: z.array(userSchema), pagination: paginationSchema }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: z.object({ ok: z.literal(false), error: z.string() }) },
    { status: 403, description: 'Insufficient permissions', schema: z.object({ ok: z.literal(false), error: z.string() }) },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List customer users (admin)',
  methods: { GET: methodDoc },
}

export default GET
