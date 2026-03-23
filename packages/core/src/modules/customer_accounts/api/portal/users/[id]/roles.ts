import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getCustomerAuthFromRequest, requireCustomerFeature } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { CustomerUser, CustomerUserRole, CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { assignRolesSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'

export const metadata: { path?: string } = {}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  try {
    requireCustomerFeature(auth, ['portal.users.roles.manage'])
  } catch (response) {
    return response as NextResponse
  }

  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: 'No company association' }, { status: 403 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid request body' }, { status: 400 })
  }

  const parsed = assignRolesSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed' }, { status: 400 })
  }

  const container = await createRequestContainer()
  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager
  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService

  // Verify target user belongs to same company
  const targetUser = await em.findOne(CustomerUser, {
    id: params.id,
    customerEntityId: auth.customerEntityId,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!targetUser) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  // Validate all roles are customer_assignable
  for (const roleId of parsed.data.roleIds) {
    const role = await em.findOne(CustomerRole, { id: roleId, tenantId: auth.tenantId, deletedAt: null })
    if (!role || !role.customerAssignable) {
      return NextResponse.json({ ok: false, error: 'Role not found or not assignable' }, { status: 400 })
    }
  }

  // Remove existing roles
  await em.nativeDelete(CustomerUserRole, { user: targetUser.id as any })

  // Assign new roles
  for (const roleId of parsed.data.roleIds) {
    const role = await em.findOne(CustomerRole, { id: roleId })
    if (role) {
      const userRole = em.create(CustomerUserRole, {
        user: targetUser,
        role,
        createdAt: new Date(),
      } as any)
      em.persist(userRole)
    }
  }
  await em.flush()

  await customerRbacService.invalidateUserCache(targetUser.id)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Update portal user roles',
  description: 'Assigns new roles to a company portal user.',
  tags: ['Customer Portal'],
  requestBody: { schema: assignRolesSchema },
  responses: [{ status: 200, description: 'Roles updated', schema: successSchema }],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Update portal user roles',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { PUT: methodDoc },
}
