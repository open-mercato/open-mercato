import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { RoleAcl, Role } from '@open-mercato/core/modules/auth/data/entities'

const getSchema = z.object({ roleId: z.string().uuid() })
const putSchema = z.object({
  roleId: z.string().uuid(),
  isSuperAdmin: z.boolean().optional(),
  features: z.array(z.string()).optional(),
  organizations: z.array(z.string()).nullable().optional(),
})

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['auth.acl.manage'] },
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = getSchema.safeParse({ roleId: url.searchParams.get('roleId') })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const acl = await em.findOne(RoleAcl, { role: parsed.data.roleId as any, tenantId: auth.tenantId as any })
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
    tenantId: auth.tenantId ?? null,
    query: { roleId: parsed.data.roleId },
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
  const em = container.resolve('em') as any
  const rbacService = container.resolve('rbacService') as any
  const role = await em.findOne(Role, { id: parsed.data.roleId })
  if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actorAcl = auth.sub
    ? await rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
    : null
  const actorIsSuperAdmin = !!actorAcl?.isSuperAdmin

  const requestedFeatures = normalizeFeatureList(parsed.data.features)
  let acl = await em.findOne(RoleAcl, { role: role as any, tenantId: auth.tenantId as any })
  if (!acl) { acl = em.create(RoleAcl, { role: role as any, tenantId: auth.tenantId as any }) }

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

  if (parsed.data.organizations !== undefined) (acl as any).organizationsJson = parsed.data.organizations
  ;(acl as any).isSuperAdmin = effectiveIsSuperAdmin
  ;(acl as any).featuresJson = effectiveFeatures
  await em.persistAndFlush(acl)
  
  // Invalidate cache for all users in this tenant since role ACL changed
  if (auth.tenantId) {
    await rbacService.invalidateTenantCache(auth.tenantId)
    // Sidebar nav caches depend on RBAC; invalidate tenant scope nav caches
    try {
      const cache = container.resolve('cache') as any
      if (cache) await cache.deleteByTags([`rbac:tenant:${auth.tenantId}`])
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
