import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole } from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata = {}

export async function GET(req: Request) {
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

  const roles = await em.find(CustomerRole, {
    tenantId: auth.tenantId,
    deletedAt: null,
  }, { orderBy: { createdAt: 'ASC' } })

  const items = roles.map((role) => ({
    id: role.id,
    name: role.name,
    slug: role.slug,
    description: role.description || null,
    isDefault: role.isDefault,
    isSystem: role.isSystem,
    customerAssignable: role.customerAssignable,
    createdAt: role.createdAt,
  }))

  return NextResponse.json({ ok: true, roles: items })
}

const roleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  isSystem: z.boolean(),
  customerAssignable: z.boolean(),
  createdAt: z.string().datetime(),
})

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'List customer roles (admin)',
  description: 'Returns all customer roles for the tenant.',
  tags: ['Customer Accounts Admin'],
  responses: [{
    status: 200,
    description: 'Role list',
    schema: z.object({ ok: z.literal(true), roles: z.array(roleSchema) }),
  }],
  errors: [
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'List customer roles (admin)',
  methods: { GET: methodDoc },
}
