import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { updateRoleSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

export const metadata = {}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
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

  const parsed = updateRoleSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Validation failed', details: parsed.error.flatten().fieldErrors }, { status: 400 })
  }

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const role = await em.findOne(CustomerRole, {
    id: params.id,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Role not found' }, { status: 404 })
  }

  if (role.isSystem && parsed.data.name !== undefined) {
    return NextResponse.json({ ok: false, error: 'Cannot change name of a system role' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (parsed.data.name !== undefined) updates.name = parsed.data.name
  if (parsed.data.description !== undefined) updates.description = parsed.data.description
  if (parsed.data.isDefault !== undefined) updates.isDefault = parsed.data.isDefault
  if (parsed.data.customerAssignable !== undefined) updates.customerAssignable = parsed.data.customerAssignable

  if (Object.keys(updates).length > 0) {
    await em.nativeUpdate(CustomerRole, { id: role.id }, updates)
  }

  void emitCustomerAccountsEvent('customer_accounts.role.updated', {
    id: role.id,
    name: updates.name as string || role.name,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Update customer role (admin)',
  description: 'Updates a customer role. System roles are protected from name changes.',
  tags: ['Customer Accounts Admin'],
  requestBody: { schema: updateRoleSchema },
  responses: [{ status: 200, description: 'Role updated', schema: successSchema }],
  errors: [
    { status: 400, description: 'Validation failed or system role restriction', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'Role not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Update customer role (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { PUT: methodDoc },
}
