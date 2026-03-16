import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerUser, CustomerUserRole, CustomerRole, CustomerUserSession } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerUserService } from '@open-mercato/core/modules/customer_accounts/services/customerUserService'
import { CustomerSessionService } from '@open-mercato/core/modules/customer_accounts/services/customerSessionService'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { adminUpdateUserSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

export const metadata = {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'Invalid user ID' }, { status: 400 })
  }

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

  const user = await em.findOne(CustomerUser, {
    id: params.id,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  const userRoles = await em.find(CustomerUserRole, {
    user: user.id as any,
    deletedAt: null,
  }, { populate: ['role'] })
  const roles = userRoles.map((ur) => ({
    id: (ur.role as any).id,
    name: (ur.role as any).name,
    slug: (ur.role as any).slug,
  }))

  const activeSessions = await em.find(CustomerUserSession, {
    user: user.id as any,
    deletedAt: null,
    expiresAt: { $gt: new Date() },
  }, { orderBy: { lastUsedAt: 'DESC' } })

  const sessions = activeSessions.map((session) => ({
    id: session.id,
    ipAddress: (session as any).ipAddress || null,
    userAgent: (session as any).userAgent || null,
    lastUsedAt: (session as any).lastUsedAt || null,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  }))

  return NextResponse.json({
    ok: true,
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerifiedAt: user.emailVerifiedAt || null,
    isActive: user.isActive,
    lockedUntil: user.lockedUntil || null,
    lastLoginAt: user.lastLoginAt || null,
    customerEntityId: user.customerEntityId || null,
    personEntityId: user.personEntityId || null,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt || null,
    roles,
    sessions,
  })
}

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
  if (parsed.data.displayName !== undefined) updates.displayName = parsed.data.displayName
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive
  if (parsed.data.lockedUntil !== undefined) updates.lockedUntil = parsed.data.lockedUntil ? new Date(parsed.data.lockedUntil) : null
  if (parsed.data.personEntityId !== undefined) updates.personEntityId = parsed.data.personEntityId
  if (parsed.data.customerEntityId !== undefined) updates.customerEntityId = parsed.data.customerEntityId

  if (Object.keys(updates).length > 0) {
    await em.nativeUpdate(CustomerUser, { id: user.id }, updates)
  }

  let rolesChanged = false
  if (parsed.data.roleIds !== undefined) {
    const validRoles: InstanceType<typeof CustomerRole>[] = []
    for (const roleId of parsed.data.roleIds) {
      const role = await em.findOne(CustomerRole, { id: roleId, tenantId: auth.tenantId, deletedAt: null })
      if (!role) {
        return NextResponse.json({ ok: false, error: `Role ${roleId} not found` }, { status: 400 })
      }
      validRoles.push(role)
    }

    await em.nativeDelete(CustomerUserRole, { user: user.id } as Record<string, unknown>)

    for (const role of validRoles) {
      const userRole = em.create(CustomerUserRole, {
        user,
        role,
        createdAt: new Date(),
      } as any)
      em.persist(userRole)
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

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
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

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const user = await em.findOne(CustomerUser, {
    id: params.id,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!user) {
    return NextResponse.json({ ok: false, error: 'User not found' }, { status: 404 })
  }

  const customerUserService = container.resolve('customerUserService') as CustomerUserService
  const customerSessionService = container.resolve('customerSessionService') as CustomerSessionService

  await customerUserService.softDelete(user.id)
  await customerSessionService.revokeAllUserSessions(user.id)

  void emitCustomerAccountsEvent('customer_accounts.user.deleted', {
    id: user.id,
    email: user.email,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    deletedBy: auth.sub,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true })
}

const roleSchema = z.object({ id: z.string().uuid(), name: z.string(), slug: z.string() })
const userDetailSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  displayName: z.string(),
  emailVerified: z.boolean(),
  isActive: z.boolean(),
  lockedUntil: z.string().datetime().nullable(),
  lastLoginAt: z.string().datetime().nullable(),
  failedLoginAttempts: z.number(),
  customerEntityId: z.string().uuid().nullable(),
  personEntityId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable(),
  roles: z.array(roleSchema),
  activeSessionCount: z.number(),
})

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Get customer user detail (admin)',
  description: 'Returns full customer user details including CRM links, roles, and active session count.',
  tags: ['Customer Accounts Admin'],
  responses: [{
    status: 200,
    description: 'User detail',
    schema: z.object({ ok: z.literal(true), user: userDetailSchema }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User not found', schema: errorSchema },
  ],
}

const putMethodDoc: OpenApiMethodDoc = {
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

const deleteMethodDoc: OpenApiMethodDoc = {
  summary: 'Delete customer user (admin)',
  description: 'Soft deletes a customer user and revokes all their active sessions.',
  tags: ['Customer Accounts Admin'],
  responses: [{ status: 200, description: 'User deleted', schema: successSchema }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'User not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer user detail management (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: getMethodDoc,
    PUT: putMethodDoc,
    DELETE: deleteMethodDoc,
  },
}
