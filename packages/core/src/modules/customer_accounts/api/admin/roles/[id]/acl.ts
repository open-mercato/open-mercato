import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole, CustomerRoleAcl } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { updateRoleAclSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'

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

  const parsed = updateRoleAclSchema.safeParse(body)
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

  const acl = await em.findOne(CustomerRoleAcl, {
    role: role.id as any,
    tenantId: auth.tenantId,
  })

  if (acl) {
    await em.nativeUpdate(CustomerRoleAcl, { id: acl.id }, {
      featuresJson: parsed.data.features,
      isPortalAdmin: parsed.data.isPortalAdmin ?? acl.isPortalAdmin,
    })
  } else {
    const newAcl = em.create(CustomerRoleAcl, {
      role,
      tenantId: auth.tenantId,
      featuresJson: parsed.data.features,
      isPortalAdmin: parsed.data.isPortalAdmin ?? false,
      createdAt: new Date(),
    } as any)
    em.persist(newAcl)
    await em.flush()
  }

  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService
  await customerRbacService.invalidateRoleCache(role.id)

  return NextResponse.json({ ok: true })
}

const successSchema = z.object({ ok: z.literal(true) })
const errorSchema = z.object({ ok: z.literal(false), error: z.string() })

const methodDoc: OpenApiMethodDoc = {
  summary: 'Update customer role ACL (admin)',
  description: 'Updates the ACL (features and portal admin flag) for a customer role. Invalidates RBAC cache after update.',
  tags: ['Customer Accounts Admin'],
  requestBody: { schema: updateRoleAclSchema },
  responses: [{ status: 200, description: 'ACL updated', schema: successSchema }],
  errors: [
    { status: 400, description: 'Validation failed', schema: errorSchema },
    { status: 401, description: 'Not authenticated', schema: errorSchema },
    { status: 403, description: 'Insufficient permissions', schema: errorSchema },
    { status: 404, description: 'Role not found', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Update customer role ACL (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { PUT: methodDoc },
}
