import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { forbidden } from '@open-mercato/shared/lib/crud/errors'
import { UserAcl } from '@open-mercato/core/modules/auth/data/entities'

const getSchema = z.object({ userId: z.string().uuid() })
const putSchema = z.object({
  userId: z.string().uuid(),
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
  const parsed = getSchema.safeParse({ userId: url.searchParams.get('userId') })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
  const response = acl
    ? {
        hasCustomAcl: true,
        isSuperAdmin: !!acl.isSuperAdmin,
        features: Array.isArray(acl.featuresJson) ? acl.featuresJson : [],
        organizations: Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null,
      }
    : { hasCustomAcl: false, isSuperAdmin: false, features: [], organizations: null }

  await logCrudAccess({
    container,
    auth,
    request: req,
    items: [{ id: parsed.data.userId, ...response }],
    idField: 'id',
    resourceKind: 'auth.user_acl',
    organizationId: auth.orgId ?? null,
    tenantId: auth.tenantId ?? null,
    query: { userId: parsed.data.userId },
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

  const actorAcl = auth.sub
    ? await rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
    : null
  const actorIsSuperAdmin = !!actorAcl?.isSuperAdmin

  const requestedFeatures = normalizeFeatureList(parsed.data.features)
  const organizations = Array.isArray(parsed.data.organizations) ? parsed.data.organizations : null

  let acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
  const existingIsSuperAdmin = acl ? !!acl.isSuperAdmin : false
  const existingFeatures = acl && Array.isArray(acl.featuresJson) ? normalizeFeatureList(acl.featuresJson) : []

  const effectiveFeatures = actorIsSuperAdmin
    ? requestedFeatures
    : sanitizeTenantFeatures(requestedFeatures)

  const requestedIsSuperAdmin = parsed.data.isSuperAdmin ?? false
  let effectiveIsSuperAdmin = requestedIsSuperAdmin

  if (!actorIsSuperAdmin) {
    if (requestedIsSuperAdmin && !existingIsSuperAdmin) {
      throw forbidden('Only super administrators can grant super admin access.')
    }
    if (existingIsSuperAdmin && requestedIsSuperAdmin === false) {
      effectiveIsSuperAdmin = false
    } else {
      effectiveIsSuperAdmin = existingIsSuperAdmin
    }
  }

  const hasCustomAcl = effectiveIsSuperAdmin || effectiveFeatures.length > 0

  if (!hasCustomAcl) {
    if (acl) await em.removeAndFlush(acl)
  } else {
    if (!acl) {
      acl = em.create(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
    }
    const aclRecord = acl as any
    aclRecord.isSuperAdmin = effectiveIsSuperAdmin
    aclRecord.featuresJson = effectiveFeatures
    aclRecord.organizationsJson = organizations
    await em.persistAndFlush(acl)
  }

  // Invalidate cache for this user
  await rbacService.invalidateUserCache(parsed.data.userId)
  try {
    const cache = container.resolve('cache') as any
    if (cache) await cache.deleteByTags([`rbac:user:${parsed.data.userId}`])
  } catch {}

  return NextResponse.json({
    ok: true,
    sanitized: !actorIsSuperAdmin && (hasRestrictedChanges(requestedFeatures, effectiveFeatures, existingFeatures) || requestedIsSuperAdmin !== effectiveIsSuperAdmin),
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

function hasRestrictedChanges(requested: string[], effective: string[], existing: string[]): boolean {
  if (requested.length === effective.length) return false
  const effectiveSet = new Set(effective)
  const existingSet = new Set(existing)
  // If the effective set matches existing, we only trimmed restricted duplicates and should not report
  if (effectiveSet.size === existingSet.size) {
    let identical = true
    for (const value of effectiveSet) {
      if (!existingSet.has(value)) {
        identical = false
        break
      }
    }
    if (identical) return false
  }
  return true
}
