import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc, OpenApiMethodDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import { CustomerRole, CustomerRoleAcl } from '@open-mercato/core/modules/customer_accounts/data/entities'
import { CustomerRbacService } from '@open-mercato/core/modules/customer_accounts/services/customerRbacService'
import { updateRoleAclSchema } from '@open-mercato/core/modules/customer_accounts/data/validators'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  runCrudMutationGuardAfterSuccess,
  validateCrudMutationGuard,
} from '@open-mercato/shared/lib/crud/mutation-guard'

export const metadata = {}

const ROLE_RESOURCE_KIND = 'customer_accounts.role'

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }
  const tenantId = auth.tenantId

  const container = await createRequestContainer()
  const rbacService = container.resolve('rbacService') as RbacService
  const hasAccess = await rbacService.userHasAllFeatures(auth.sub, ['customer_accounts.roles.manage'], { tenantId, organizationId: auth.orgId })
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
    tenantId,
    deletedAt: null,
  })
  if (!role) {
    return NextResponse.json({ ok: false, error: 'Role not found' }, { status: 404 })
  }

  // The ACL is part of the role aggregate: the role-edit screen loads and saves
  // the role and its permissions together. Guard the write against the parent
  // role's `updatedAt` so two admins editing the same role cannot silently
  // overwrite each other's permission changes (#3194). Strictly additive — when
  // the client sends no expected-version header the helper is a no-op.
  try {
    enforceCommandOptimisticLock({
      resourceKind: ROLE_RESOURCE_KIND,
      resourceId: role.id,
      current: role.updatedAt ?? null,
      request: req,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  const guardResult = await validateCrudMutationGuard(container, {
    tenantId,
    organizationId: auth.orgId,
    userId: auth.sub,
    resourceKind: ROLE_RESOURCE_KIND,
    resourceId: role.id,
    operation: 'update',
    requestMethod: req.method,
    requestHeaders: req.headers,
    mutationPayload: parsed.data,
  })
  if (guardResult && !guardResult.ok) {
    return NextResponse.json(guardResult.body, { status: guardResult.status })
  }

  const acl = await em.findOne(CustomerRoleAcl, {
    role: role.id as any,
    tenantId,
  })

  if (acl) {
    await em.nativeUpdate(CustomerRoleAcl, { id: acl.id }, {
      featuresJson: parsed.data.features,
      isPortalAdmin: parsed.data.isPortalAdmin ?? acl.isPortalAdmin,
    })
  } else {
    const newAcl = em.create(CustomerRoleAcl, {
      role,
      tenantId,
      featuresJson: parsed.data.features,
      isPortalAdmin: parsed.data.isPortalAdmin ?? false,
      createdAt: new Date(),
    } as any)
    em.persist(newAcl)
    await em.flush()
  }

  // Bump the aggregate version so a stale role-edit screen (which holds the role's
  // pre-edit `updatedAt`) cannot save old permission arrays afterwards. `nativeUpdate`
  // bypasses MikroORM's `onUpdate` hook, so set it explicitly.
  const nextUpdatedAt = new Date()
  await em.nativeUpdate(CustomerRole, { id: role.id }, { updatedAt: nextUpdatedAt })

  const customerRbacService = container.resolve('customerRbacService') as CustomerRbacService
  await customerRbacService.invalidateRoleCache(role.id)

  if (guardResult?.ok && guardResult.shouldRunAfterSuccess) {
    await runCrudMutationGuardAfterSuccess(container, {
      tenantId,
      organizationId: auth.orgId,
      userId: auth.sub,
      resourceKind: ROLE_RESOURCE_KIND,
      resourceId: role.id,
      operation: 'update',
      requestMethod: req.method,
      requestHeaders: req.headers,
      metadata: guardResult.metadata ?? null,
    })
  }

  return NextResponse.json({ ok: true, updatedAt: nextUpdatedAt.toISOString() })
}

const successSchema = z.object({ ok: z.literal(true), updatedAt: z.string().datetime() })
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
    { status: 409, description: 'Stale ACL write (optimistic-lock conflict)', schema: errorSchema },
  ],
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Update customer role ACL (admin)',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: { PUT: methodDoc },
}
