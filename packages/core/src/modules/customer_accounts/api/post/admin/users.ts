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

export const metadata: { path?: string } = {}

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
      } as Partial<InstanceType<typeof CustomerUserRole>>)
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

const successSchema = z.object({
  ok: z.literal(true),
  user: z.object({ id: z.string().uuid(), email: z.string(), displayName: z.string() }),
})
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
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
  summary: 'Create customer user (admin)',
  methods: { POST: methodDoc },
}

export default POST
