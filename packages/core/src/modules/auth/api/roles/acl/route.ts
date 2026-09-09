import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { RoleAcl, Role } from '@open-mercato/core/modules/auth/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import {
  assertActorCanGrantAcl,
  assertActorCanModifySuperAdminRoleTarget,
  normalizeGrantFeatureList,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import {
  AUTH_ROLE_ACL_UPDATE_COMMAND_ID,
  type AclUpdateResult,
  type RoleAclUpdateInput,
} from '@open-mercato/core/modules/auth/commands/acl'

const getSchema = z.object({
  roleId: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
})
const putSchema = z.object({
  roleId: z.string().uuid(),
  isSuperAdmin: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  organizations: z.array(z.string()).nullable().optional(),
  tenantId: z.string().uuid().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
}

const roleAclResponseSchema = z.object({
  isSuperAdmin: z.boolean(),
  features: z.array(z.string()),
  organizations: z.array(z.string()).nullable(),
  updatedAt: z.string().nullable(),
})

const roleAclUpdateResponseSchema = z.object({
  ok: z.literal(true),
  sanitized: z.boolean(),
})

const roleAclErrorSchema = z.object({ error: z.string() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = getSchema.safeParse({
    roleId: url.searchParams.get('roleId'),
    tenantId: url.searchParams.get('tenantId') || undefined,
  })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const container = await createRequestContainer()
  const isSuperAdmin = await resolveIsSuperAdmin({ auth, container })
  const em = container.resolve('em') as EntityManager
  const authTenantId = auth.tenantId ?? null
  const roleFilter: Record<string, unknown> = { id: parsed.data.roleId }
  if (!isSuperAdmin && authTenantId) {
    roleFilter.$or = [{ tenantId: authTenantId }, { tenantId: null }]
  }
  const role = await em.findOne(Role, roleFilter)
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const roleTenantId = role?.tenantId ? String(role.tenantId) : null

  let tenantScope = parsed.data.tenantId ?? roleTenantId ?? authTenantId ?? null
  if (parsed.data.tenantId && parsed.data.tenantId !== tenantScope) {
    if (isSuperAdmin || parsed.data.tenantId === authTenantId) tenantScope = parsed.data.tenantId
    else return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!tenantScope && !isSuperAdmin) tenantScope = authTenantId ?? null

  if (!isSuperAdmin && auth.sub) {
    try {
      await assertActorCanModifySuperAdminRoleTarget({
        em,
        rbacService: container.resolve('rbacService') as RbacService,
        actorUserId: auth.sub,
        tenantId: tenantScope,
        organizationId: auth.orgId ?? null,
        targetRoleId: parsed.data.roleId,
        actorIsSuperAdmin: false,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }

  const acl = tenantScope
    ? await em.findOne(RoleAcl, { role, tenantId: tenantScope })
    : null
  const response = acl
    ? {
        isSuperAdmin: !!acl.isSuperAdmin,
        features: Array.isArray(acl.featuresJson) ? acl.featuresJson : [],
        organizations: Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null,
        updatedAt: acl.updatedAt instanceof Date ? acl.updatedAt.toISOString() : null,
      }
    : { isSuperAdmin: false, features: [], organizations: null, updatedAt: null }

  await logCrudAccess({
    container,
    auth,
    request: req,
    items: [{ id: parsed.data.roleId, ...response }],
    idField: 'id',
    resourceKind: 'auth.role_acl',
    organizationId: auth.orgId ?? null,
    tenantId: tenantScope,
    query: { roleId: parsed.data.roleId, tenantId: tenantScope },
    accessType: 'read:item',
  })

  return NextResponse.json(response)
}

export async function PUT(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const parsed = putSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const isSuperAdmin = await resolveIsSuperAdmin({ auth, container })
  const rbacService = container.resolve('rbacService') as RbacService
  const authTenantId = auth.tenantId ?? null
  const putRoleFilter: Record<string, unknown> = { id: parsed.data.roleId }
  if (!isSuperAdmin && authTenantId) {
    putRoleFilter.$or = [{ tenantId: authTenantId }, { tenantId: null }]
  }
  const role = await em.findOne(Role, putRoleFilter)
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const roleTenantId = role?.tenantId ? String(role.tenantId) : null

  let targetTenantId = parsed.data.tenantId ?? roleTenantId ?? authTenantId ?? null
  if (parsed.data.tenantId && parsed.data.tenantId !== targetTenantId) {
    if (isSuperAdmin || parsed.data.tenantId === authTenantId) {
      targetTenantId = parsed.data.tenantId
    } else {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }
  if (!targetTenantId && !isSuperAdmin) targetTenantId = authTenantId ?? null
  if (!targetTenantId) return NextResponse.json({ error: 'Tenant required' }, { status: 400 })

  if (!isSuperAdmin && targetTenantId !== authTenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!isSuperAdmin && auth.sub) {
    try {
      await assertActorCanModifySuperAdminRoleTarget({
        em,
        rbacService,
        actorUserId: auth.sub,
        tenantId: targetTenantId,
        organizationId: auth.orgId ?? null,
        targetRoleId: parsed.data.roleId,
        actorIsSuperAdmin: false,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }

  const acl = await em.findOne(RoleAcl, { role, tenantId: targetTenantId })
  // Optimistic lock: refuse a stale ACL overwrite so two admins editing the same
  // role's features in parallel cannot silently clobber each other (#2055). The
  // check is strictly additive — when the client sends no expected-version header
  // it is a no-op. Skipped when the ACL row does not exist yet (first grant has
  // no prior version to conflict with).
  if (acl) {
    try {
      await enforceCommandOptimisticLockWithGuards(container, {
        resourceKind: 'auth.role_acl',
        resourceId: acl.id,
        current: acl.updatedAt ?? null,
        request: req,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }

  const existingIsSuperAdmin = !!acl?.isSuperAdmin
  const existingFeatures = normalizeGrantFeatureList(acl?.featuresJson)
  const existingOrganizations = normalizeOrganizations(acl?.organizationsJson)
  const requestedIsSuperAdmin = parsed.data.isSuperAdmin ?? existingIsSuperAdmin
  const requestedFeatures = parsed.data.features === undefined
    ? existingFeatures
    : normalizeGrantFeatureList(parsed.data.features)
  const requestedOrganizations = parsed.data.organizations === undefined
    ? existingOrganizations
    : normalizeOrganizations(parsed.data.organizations)

  try {
    await assertActorCanGrantAcl({
      em,
      rbacService,
      actorUserId: auth.sub,
      tenantId: targetTenantId,
      organizationId: auth.orgId ?? null,
      isSuperAdmin: requestedIsSuperAdmin,
      features: requestedFeatures,
      organizations: requestedOrganizations,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  // Route the write through the command bus so the permission change lands in
  // the action log. The command owns the transactional write and the RBAC cache
  // invalidation that used to live here.
  const commandBus = container.resolve('commandBus') as CommandBus
  // A super admin may edit a role in another tenant. The actor's organization
  // belongs to *their* tenant, and the command bus resolves the log row's
  // organization as `metadata.organizationId ?? ctx.selectedOrganizationId ??
  // ctx.auth.orgId` — a `??` chain, so a handler cannot express "explicitly no
  // organization" on its own. Strip the organization from the context instead,
  // otherwise the entry is stamped (target tenant, actor's foreign organization)
  // and `ActionLogService` — which filters organization with strict equality —
  // can never surface it for anyone.
  const isForeignTenant = targetTenantId !== (auth.tenantId ?? null)
  const actorOrgId = isForeignTenant ? null : auth.orgId ?? null
  const commandCtx: CommandRuntimeContext = {
    container,
    auth: isForeignTenant ? { ...auth, orgId: null } : auth,
    organizationScope: null,
    selectedOrganizationId: actorOrgId,
    organizationIds: actorOrgId ? [actorOrgId] : null,
    request: req,
  }
  await commandBus.execute<RoleAclUpdateInput, AclUpdateResult>(AUTH_ROLE_ACL_UPDATE_COMMAND_ID, {
    input: {
      roleId: String(role.id),
      tenantId: targetTenantId,
      isSuperAdmin: requestedIsSuperAdmin,
      features: requestedFeatures,
      organizations: requestedOrganizations,
    },
    ctx: commandCtx,
  })

  return NextResponse.json({
    ok: true,
    sanitized: false,
  })
}

function normalizeOrganizations(organizations: unknown): string[] | null {
  if (!Array.isArray(organizations)) return null
  return normalizeGrantFeatureList(organizations)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'Role ACL management',
  methods: {
    GET: {
      summary: 'Fetch role ACL',
      description: 'Returns the feature and organization assignments associated with a role within the current tenant.',
      query: getSchema,
      responses: [
        { status: 200, description: 'Role ACL entry', schema: roleAclResponseSchema },
        { status: 400, description: 'Invalid role id', schema: roleAclErrorSchema },
        { status: 401, description: 'Unauthorized', schema: roleAclErrorSchema },
        { status: 404, description: 'Role not found', schema: roleAclErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update role ACL',
      description: 'Replaces the feature list, super admin flag, and optional organization assignments for a role.',
      requestBody: {
        contentType: 'application/json',
        schema: putSchema,
      },
      responses: [
        { status: 200, description: 'Role ACL updated', schema: roleAclUpdateResponseSchema },
        { status: 400, description: 'Invalid payload', schema: roleAclErrorSchema },
        { status: 401, description: 'Unauthorized', schema: roleAclErrorSchema },
        { status: 403, description: 'Insufficient privileges to modify ACL', schema: roleAclErrorSchema },
        { status: 404, description: 'Role not found', schema: roleAclErrorSchema },
      ],
    },
  },
}
