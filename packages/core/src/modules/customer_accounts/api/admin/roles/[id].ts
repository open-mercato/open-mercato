import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole, CustomerRoleAcl, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { updateRoleSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

export const metadata = {}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(req: Request, { params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) {
    return NextResponse.json({ ok: false, error: 'Invalid role ID' }, { status: 400 })
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

  const role = await em.findOne(CustomerRole, {
    id: params.id,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Role not found' }, { status: 404 })
  }

  const acl = await em.findOne(CustomerRoleAcl, {
    role: role.id as any,
    tenantId: auth.tenantId,
  })

  const features = acl && Array.isArray(acl.featuresJson) ? acl.featuresJson : []

  return NextResponse.json({
    ok: true,
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description || null,
    isDefault: role.isDefault,
    isSystem: role.isSystem,
    customerAssignable: role.customerAssignable,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt || null,
    features,
  })
}

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

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
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

  const em = container.resolve('em') as import('@mikro-orm/postgresql').EntityManager

  const role = await em.findOne(CustomerRole, {
    id: params.id,
    tenantId: auth.tenantId,
    deletedAt: null,
  })
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Role not found' }, { status: 404 })
  }

  if (role.isSystem) {
    return NextResponse.json({ ok: false, error: 'Cannot delete a system role' }, { status: 400 })
  }

  const assignedUsersCount = await em.count(CustomerUserRole, {
    role: role.id as any,
    deletedAt: null,
  })
  if (assignedUsersCount > 0) {
    return NextResponse.json({ ok: false, error: `Cannot delete role with ${assignedUsersCount} assigned user(s). Reassign users first.` }, { status: 400 })
  }

  await em.nativeUpdate(CustomerRole, { id: role.id }, { deletedAt: new Date() })
  await em.nativeUpdate(CustomerRoleAcl, { role: role.id as any }, { deletedAt: new Date() })

  void emitCustomerAccountsEvent('customer_accounts.role.deleted', {
    id: role.id,
    name: role.name,
    slug: role.slug,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
  }).catch(() => undefined)

  return NextResponse.json({ ok: true })
}

const aclSchema = z.object({
  features: z.array(z.string()),
  isPortalAdmin: z.boolean(),
})
const roleDetailSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  customerAssignable: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().nullable(),
  acl: aclSchema,
})

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const getMethodDoc: OpenApiMethodDoc = {
  summary: 'Get customer role detail (admin)',
  description: 'Returns full customer role details including ACL features.',
  tags: ['Customer Accounts Admin'],
  responses: [{
    status: 200,
    description: 'Role detail with ACL',
    schema: z.object({ ok: z.literal(true), role: roleDetailSchema }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'Role not found', schema: errorSchema },
  ],
}

const putMethodDoc: OpenApiMethodDoc = {
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

const deleteMethodDoc: OpenApiMethodDoc = {
  summary: 'Delete customer role (admin)',
  description: 'Soft deletes a customer role and its ACL. System roles and roles with assigned users cannot be deleted.',
  tags: ['Customer Accounts Admin'],
  responses: [{ status: 200, description: 'Role deleted', schema: successSchema }],
  errors: [
    { status: 400, description: 'System role or has assigned users', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'Role not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Customer role detail management (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    GET: getMethodDoc,
    PUT: putMethodDoc,
    DELETE: deleteMethodDoc,
  },
}
