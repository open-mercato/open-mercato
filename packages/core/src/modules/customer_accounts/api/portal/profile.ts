import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, requireCustomerFeature } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { profileUpdateSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'

export const metadata: { path?: string } = {}

export async function GET(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const user = await customerUserService.findById(auth.sub, auth.tenantId)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  const acl = await customerRbacService.loadAcl(user.id, { tenantId: user.tenantId, organizationId: user.organizationId })

  const userRoles = await em.find(CustomerUserRole, {
    user: user.id as any,
    deletedAt: null,
  }, { populate: ['role'] })
  const roles = userRoles.map((ur) => ({
    id: (ur.role as any).id,
    name: (ur.role as any).name,
    slug: (ur.role as any).slug,
  }))

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      emailVerified: !!user.emailVerifiedAt,
      customerEntityId: user.customerEntityId,
      personEntityId: user.personEntityId,
      isActive: user.isActive,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
    },
    roles,
    resolvedFeatures: acl.features,
    isPortalAdmin: acl.isPortalAdmin,
  })
}

export async function PUT(req: Request) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  try {
    requireCustomerFeature(auth, ['portal.account.manage'])
  } catch (response) {
    return response as NextResponse
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = profileUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const customerUserService = container.resolve('customerUserService') as CustomerUserService

  const user = await customerUserService.findById(auth.sub, auth.tenantId)
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  await customerUserService.updateProfile(user, parsed.data)

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
    },
  })
}

const profileSchema = z.object({
  ok: z.literal(true),
  user: z.object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string(),
    emailVerified: z.boolean(),
    customerEntityId: z.string().uuid().nullable(),
    personEntityId: z.string().uuid().nullable(),
    isActive: z.boolean(),
    lastLoginAt: z.string().datetime().nullable(),
    createdAt: z.string().datetime(),
  }),
  roles: z.array(z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })),
  resolvedFeatures: z.array(z.string()),
  isPortalAdmin: z.boolean(),
})

const putSuccessSchema = z.object({
  ok: z.literal(true),
  user: z.object({ id: z.string().uuid(), email: z.string(), displayName: z.string() }),
})
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Get customer profile',
  description: 'Returns the authenticated customer user profile with roles and permissions.',
  tags: ['Customer Portal'],
  responses: [{ status: 200, description: 'Profile data', schema: profileSchema }],
  errors: [{ status: 401, description: 'Not authenticated', schema: errorSchema }],
}

const putMethodDoc: OpenApiMethodDoc = {
  summary: 'Update customer profile',
  description: 'Updates the authenticated customer user profile.',
  tags: ['Customer Portal'],
  requestBody: { schema: profileUpdateSchema },
  responses: [{ status: 200, description: 'Profile updated', schema: putSuccessSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer profile',
  methods: { GET: getMethodDoc, PUT: putMethodDoc },
}
