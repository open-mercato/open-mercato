import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole, CustomerRoleAcl } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { createRoleSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
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

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.roles.manage'], { tenantId: auth.tenantId, organizationId: auth.orgId })
  if (!hasAccess) {
    return NextResponse.json({ ok: false, error: 'Insufficient permissions' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = createRoleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const existing = await em.findOne(CustomerRole, {
    tenantId: auth.tenantId,
    slug: parsed.data.slug,
    deletedAt: null,
  })
  if (existing) {
    return NextResponse.json({ ok: false, error: 'A role with this slug already exists' }, { status: 409 })
  }

  const role = em.create(CustomerRole, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    name: parsed.data.name,
    slug: parsed.data.slug,
    description: parsed.data.description || null,
    isDefault: parsed.data.isDefault ?? false,
    customerAssignable: parsed.data.customerAssignable ?? false,
    isSystem: false,
    createdAt: new Date(),
  } as any) as CustomerRole
  em.persist(role)

  const acl = em.create(CustomerRoleAcl, {
    role,
    tenantId: auth.tenantId,
    featuresJson: [],
    isPortalAdmin: false,
    createdAt: new Date(),
  } as any)
  em.persist(acl)

  await em.flush()

  void emitCustomerAccountsEvent('customer_accounts.role.created', {
    id: role.id,
    name: role.name,
    slug: role.slug,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }).catch(() => undefined)

  return NextResponse.json({
    ok: true,
    role: {
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description || null,
      isDefault: role.isDefault,
      isSystem: role.isSystem,
      customerAssignable: role.customerAssignable,
      createdAt: role.createdAt,
    },
  }, { status: 201 })
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

const roleResponseSchema = z.object({
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

const getMethodDoc: OpenApiMethodDoc = {
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

const postMethodDoc: OpenApiMethodDoc = {
  summary: 'Create customer role (admin)',
  description: 'Creates a new customer role with an empty ACL.',
  tags: ['Customer Accounts Admin'],
  requestBody: { schema: createRoleSchema },
  responses: [{ status: 201, description: 'Role created', schema: z.object({ ok: z.literal(true), role: roleResponseSchema }) }],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 409, description: 'Slug already exists', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer role management (admin)',
  methods: {
    GET: getMethodDoc,
    POST: postMethodDoc,
  },
}
