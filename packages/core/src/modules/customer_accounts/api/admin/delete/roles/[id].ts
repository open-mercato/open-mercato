import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole, CustomerRoleAcl, CustomerUserRole } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { emitCustomerAccountsEvent } from '@open-mercato/core/modules/customer_accounts/events'

export const metadata = {}

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

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
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
  summary: 'Delete customer role (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { DELETE: methodDoc },
}

export default DELETE
