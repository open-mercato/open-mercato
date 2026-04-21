import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, requireCustomerFeature } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { CustomerUser, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { findAndCountWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata: { path?: string; requireAuth?: boolean } = { requireAuth: false }

export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService

  try {
    await requireCustomerFeature(auth, ['portal.users.view'], customerRbacService)
  } catch (response) {
    return response as NextResponse
  }

  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: 'No company association' }, { status: 403 })
  }

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const url = new URL(req.url)
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '25')))
  const offset = (page - 1) * pageSize

  const [users, total] = await findAndCountWithDecryption(
    em,
    CustomerUser,
    {
      customerEntityId: auth.customerEntityId,
      tenantId: auth.tenantId,
      deletedAt: null,
    } as any,
    {
      orderBy: { createdAt: 'DESC' },
      limit: pageSize,
      offset,
    },
    { tenantId: auth.tenantId, organizationId: auth.orgId },
  )

  const pageUserIds = users.map((user) => user.id)
  const userRoleLinks = pageUserIds.length > 0
    ? await findWithDecryption(
        em,
        CustomerUserRole,
        { user: { $in: pageUserIds } as any, deletedAt: null } as any,
        { populate: ['role'] },
        { tenantId: auth.tenantId, organizationId: auth.orgId },
      )
    : []

  const rolesByUserId = new Map<string, Array<{ id: string; name: string; slug: string }>>()
  for (const link of userRoleLinks) {
    const linkUserId = (link.user as any)?.id ?? (link.user as unknown as string)
    const role = link.role as any
    const bucket = rolesByUserId.get(linkUserId)
    const entry = { id: role.id, name: role.name, slug: role.slug }
    if (bucket) bucket.push(entry)
    else rolesByUserId.set(linkUserId, [entry])
  }

  const items = users.map((user) => ({
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerified: !!user.emailVerifiedAt,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    roles: rolesByUserId.get(user.id) ?? [],
  }))

  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return NextResponse.json({
    ok: true,
    users: items,
    total,
    totalPages,
    page,
    pageSize,
  })
}

const userSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  roles: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })),
})

const methodDoc: OpenApiMethodDoc = {
  summary: 'List company portal users',
  description: 'Lists portal users associated with the same company. Paginated (default pageSize 25, max 100).',
  tags: ['Customer Portal'],
  query: z.object({
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
  }),
  responses: [{
    status: 200,
    description: 'Paginated user list',
    schema: z.object({
      ok: z.literal(true),
      users: z.array(userSchema),
      total: z.number(),
      totalPages: z.number(),
      page: z.number(),
      pageSize: z.number(),
    }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: z.object({ ok: z.literal(false), error: z.string() }) },
    { status: 403, description: 'Insufficient permissions', schema: z.object({ ok: z.literal(false), error: z.string() }) },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List company portal users',
  methods: { GET: methodDoc },
}
