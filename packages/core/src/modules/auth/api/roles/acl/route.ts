import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { RoleAcl, Role } from '@open-mercato/core/modules/auth/data/entities'
import type { EntityManager } from '@mikro-orm/postgresql'
import { resolveIsSuperAdmin } from '@open-mercato/core/modules/auth/lib/tenantAccess'
import { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'

type TaggableCache = { deleteByTags?: (tags: string[]) => Promise<void> | void }

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
  const role = await em.findOne(Role, { id: parsed.data.roleId })
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const roleTenantId = role?.tenantId ? String(role.tenantId) : null
  const authTenantId = auth.tenantId ?? null

  if (!isSuperAdmin && roleTenantId && authTenantId && roleTenantId !== authTenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let tenantScope = parsed.data.tenantId ?? roleTenantId ?? authTenantId ?? null
  if (parsed.data.tenantId && parsed.data.tenantId !== tenantScope) {
    if (isSuperAdmin || parsed.data.tenantId === authTenantId) tenantScope = parsed.data.tenantId
    else return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  if (!tenantScope && !isSuperAdmin) tenantScope = authTenantId ?? null

  const acl = tenantScope
    ? await em.findOne(RoleAcl, { role, tenantId: tenantScope })
    : null
  const response = acl
    ? {
        isSuperAdmin: !!acl.isSuperAdmin,
        features: Array.isArray(acl.featuresJson) ? acl.featuresJson : [],
        organizations: Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null,
      }
    : { isSuperAdmin: false, features: [], organizations: null }

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
  const role = await em.findOne(Role, { id: parsed.data.roleId })
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const roleTenantId = role?.tenantId ? String(role.tenantId) : null
  const authTenantId = auth.tenantId ?? null

  if (!isSuperAdmin && roleTenantId && authTenantId && roleTenantId !== authTenantId) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

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

  const actorAcl = auth.sub
    ? await rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
    : null
  const actorIsSuperAdmin = !!actorAcl?.isSuperAdmin

  const requestedFeatures = normalizeFeatureList(parsed.data.features)
  let acl = await em.findOne(RoleAcl, { role, tenantId: targetTenantId })
  if (!acl) {
    acl = em.create(RoleAcl, {
      role,
      tenantId: targetTenantId,
      createdAt: new Date(),
      isSuperAdmin: false,
    })
  }

  const existingIsSuperAdmin = !!acl.isSuperAdmin
  const requestedIsSuperAdmin = parsed.data.isSuperAdmin ?? existingIsSuperAdmin
  let effectiveIsSuperAdmin = requestedIsSuperAdmin

  if (!actorIsSuperAdmin) {
    if (requestedIsSuperAdmin && !existingIsSuperAdmin) {
      throw forbidden('Only super administrators can mark a role as super admin.')
    }
    if (existingIsSuperAdmin && requestedIsSuperAdmin === false) {
      effectiveIsSuperAdmin = false
    } else {
      effectiveIsSuperAdmin = existingIsSuperAdmin
    }
  }

  const effectiveFeatures = actorIsSuperAdmin
    ? requestedFeatures
    : sanitizeTenantFeatures(requestedFeatures)

  if (parsed.data.organizations !== undefined) acl.organizationsJson = parsed.data.organizations
  acl.isSuperAdmin = effectiveIsSuperAdmin
  acl.featuresJson = effectiveFeatures
  await em.persistAndFlush(acl)
  
  // Invalidate cache for all users in this tenant since role ACL changed
  if (targetTenantId) {
    await rbacService.invalidateTenantCache(targetTenantId)
    // Sidebar nav caches depend on RBAC; invalidate tenant scope nav caches
    try {
      const cache = container.resolve('cache') as TaggableCache | undefined
      if (cache?.deleteByTags) await cache.deleteByTags([`rbac:tenant:${targetTenantId}`])
    } catch {}
  }
  
  return NextResponse.json({
    ok: true,
    sanitized: !actorIsSuperAdmin && (effectiveFeatures.length !== requestedFeatures.length || effectiveIsSuperAdmin !== requestedIsSuperAdmin),
  })
}

function normalizeFeatureList(features: unknown): string[] {
  if (!Array.isArray(features)) return []
  const dedup = new Set<string>()
  for (const value of features) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed) continue
    dedup.add(trimmed)
  }
  return Array.from(dedup)
}

function sanitizeTenantFeatures(features: string[]): string[] {
  return features.filter((feature) => !isTenantRestrictedFeature(feature))
}

function isTenantRestrictedFeature(feature: string): boolean {
  if (feature === '*' || feature === 'directory.*') return true
  if (feature.startsWith('directory.tenants')) return true
  return false
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
