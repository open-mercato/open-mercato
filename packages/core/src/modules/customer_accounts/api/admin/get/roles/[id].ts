import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole, CustomerRoleAcl } from '@open-mercato/core/modules/customer_accounts/data/entities'

export const metadata = {}

export async function GET(req: Request, { params }: { params: { id: string } }) {
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

  return NextResponse.json({
    ok: true,
    role: {
      id: role.id,
      name: role.name,
      slug: role.slug,
      description: role.description || null,
      isDefault: role.isDefault,
      isSystem: role.isSystem,
      customerAssignable: role.customerAssignable,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt || null,
      acl: acl ? {
        features: Array.isArray(acl.featuresJson) ? acl.featuresJson : [],
        isPortalAdmin: acl.isPortalAdmin,
      } : {
        features: [],
        isPortalAdmin: false,
      },
    },
  })
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

const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
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

export const openApi: OpenApiRouteDoc = {
  summary: 'Get customer role detail (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { GET: methodDoc },
}

export default GET
