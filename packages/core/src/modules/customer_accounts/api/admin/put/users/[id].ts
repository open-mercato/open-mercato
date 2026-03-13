import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUser, CustomerUserRole, CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { adminUpdateUserSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

export const metadata = {}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
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

  const parsed = adminUpdateUserSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const user = await em.findOne(CustomerUser, {
    id: params.id,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive
  if (parsed.data.lockedUntil !== undefined) updates.lockedUntil = parsed.data.lockedUntil ? new Date(parsed.data.lockedUntil) : null
  if (parsed.data.personEntityId !== undefined) updates.personEntityId = parsed.data.personEntityId
  if (parsed.data.customerEntityId !== undefined) updates.customerEntityId = parsed.data.customerEntityId

  if (Object.keys(updates).length > 0) {
    await em.nativeUpdate(CustomerUser, { id: user.id }, updates)
  }

  let rolesChanged = false
  if (parsed.data.roleIds !== undefined) {
    // Validate all role IDs exist for the tenant
    for (const roleId of parsed.data.roleIds) {
      const role = await em.findOne(CustomerRole, { id: roleId, tenantId: auth.tenantId, deletedAt: null })
      if (!role) {
        return NextResponse.json({ ok: false, error: `Role ${roleId} not found` }, { status: 400 })
      }
    }

    // Replace all roles (staff bypass of customer_assignable check)
    await em.nativeDelete(CustomerUserRole, { user: user.id as any })

    for (const roleId of parsed.data.roleIds) {
      const role = await em.findOne(CustomerRole, { id: roleId })
      if (role) {
        const userRole = em.create(CustomerUserRole, {
          user,
          role,
          createdAt: new Date(),
        } as any)
        em.persist(userRole)
      }
    }
    await em.flush()
    rolesChanged = true
  }

  if (rolesChanged) {
    const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService
    await customerRbacService.invalidateUserCache(user.id)
  }

  void emitCustomerAccountsEvent('customer_accounts.user.updated', {
    id: user.id,
    email: user.email,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    updatedBy: auth.sub,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Update customer user (admin)',
  description: 'Updates a customer user. Staff can update status, lock, CRM links, and roles. Role assignment bypasses customer_assignable check.',
  tags: ['Customer Accounts Admin'],
  requestBody: { schema: adminUpdateUserSchema },
  responses: [{ status: 200, description: 'User updated', schema: successSchema }],
  errors: [
    { status: 400, description: 'Validation failed or role not found', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Update customer user (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { PUT: methodDoc },
}
