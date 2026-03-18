import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, requireCustomerFeature } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUser, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata: { path?: string } = {}

export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  try {
    requireCustomerFeature(auth, ['portal.users.view'])
  } catch (response) {
    return response as NextResponse
  }

  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: 'No company association' }, { status: 403 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const users = await em.find(CustomerUser, {
    customerEntityId: auth.customerEntityId,
    tenantId: auth.tenantId,
    deletedAt: null,
  }, { orderBy: { createdAt: 'DESC' } })

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
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles,
    }
  }))

  return NextResponse.json({ ok: true, users: items })
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
  description: 'Lists all portal users associated with the same company.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'User list', schema: z.object({ ok: z.literal(true), users: z.array(userSchema) }) }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: z.object({ ok: z.literal(false), error: z.string() }) },
    { status: 403, description: 'Insufficient permissions', schema: z.object({ ok: z.literal(false), error: z.string() }) },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List company portal users',
  methods: { GET: methodDoc },
}
