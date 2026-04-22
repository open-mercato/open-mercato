import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerUser, CustomerUserRole, CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { adminCreateUserSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

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

  const em = container.resolve('em') as EntityManager

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25')))
  const status = url.searchParams.get('status') as 'active' | 'inactive' | 'locked' | null
  const customerEntityId = url.searchParams.get('customerEntityId')
  const personEntityId = url.searchParams.get('personEntityId')
  const roleId = url.searchParams.get('roleId')
  const search = url.searchParams.get('search')

  const where: Record<string, unknown> = {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
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

  if (personEntityId) {
    where.personEntityId = personEntityId
  }

  if (search) {
    const escapedSearch = search.replace(/[%_\\]/g, '\\$&')
    const searchFilter = [
      { email: { $ilike: `%${escapedSearch}%` } },
      { displayName: { $ilike: `%${escapedSearch}%` } },
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
        items: [],
        total: 0,
        totalPages: 1,
        page,
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

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({
    ok: true,
    items,
    total,
    totalPages,
    page,
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.manage'], { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = adminCreateUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const em = container.resolve('em') as EntityManager
  const customerUserService = container.resolve('customerUserService') as CustomerUserService

  const existing = await customerUserService.findByEmail(parsed.data.email, auth.tenantId!)
  if (existing) {
    return NextResponse.json({ ok: false, error: 'A user with this email already exists' }, { status: 409 })
  }

  const user = await customerUserService.createUser(
    parsed.data.email,
    parsed.data.password,
    parsed.data.displayName,
    { tenantId: auth.tenantId!, organizationId: auth.orgId! },
  )
  em.persist(user)
  await em.flush()

  if (parsed.data.customerEntityId) {
    await em.nativeUpdate(CustomerUser, { id: user.id }, { customerEntityId: parsed.data.customerEntityId })
  }

  if (parsed.data.roleIds && parsed.data.roleIds.length > 0) {
    const validRoles: InstanceType<typeof CustomerRole>[] = []
    for (const roleId of parsed.data.roleIds) {
      const role = await em.findOne(CustomerRole, { id: roleId, tenantId: auth.tenantId, deletedAt: null })
      if (role) validRoles.push(role)
    }
    for (const role of validRoles) {
      const userRole = em.create(CustomerUserRole, {
        user,
        role,
        createdAt: new Date(),
      } as any)
      em.persist(userRole)
    }
    await em.flush()
  }

  void emitCustomerAccountsEvent('customer_accounts.user.created', {
    id: user.id,
    email: user.email,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    createdBy: auth.sub,
  }).catch(() => undefined)

  return NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, displayName: user.displayName },
  }, { status: 201 })
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

const successSchema = z.object({
  ok: z.literal(true),
  user: z.object({ id: z.string().uuid(), email: z.string(), displayName: z.string() }),
})
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const getMethodDoc: OpenApiMethodDoc = {
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
    schema: z.object({ ok: z.literal(true), items: z.array(userSchema), total: z.number(), totalPages: z.number(), page: z.number() }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Create customer user (admin)',
  description: 'Creates a new customer user directly. Staff-initiated, bypasses signup flow.',
  tags: ['Customer Accounts Admin'],
  requestBody: { schema: adminCreateUserSchema },
  responses: [{ status: 201, description: 'User created', schema: successSchema }],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 409, description: 'Email already exists', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer user management (admin)',
  methods: {
    GET: getMethodDoc,
    POST: postMethodDoc,
  },
}
