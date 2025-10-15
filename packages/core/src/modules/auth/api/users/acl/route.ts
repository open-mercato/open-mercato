import { NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
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
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const rbacService = resolve('rbacService') as any
  
  const isSuperAdmin = parsed.data.isSuperAdmin ?? false
  const features = parsed.data.features ?? []
  const organizations = parsed.data.organizations ?? null
  
  // If there's no custom ACL data (not super admin and no features), delete the UserAcl record
  const hasCustomAcl = isSuperAdmin || (features.length > 0)
  
  let acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
  
  if (!hasCustomAcl) {
    // No custom ACL - delete the record if it exists so user relies on role-based ACL
    if (acl) {
      await em.removeAndFlush(acl)
    }
  } else {
    // Has custom ACL - create or update the record
    if (!acl) { 
      acl = em.create(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any }) 
    }
    const aclRecord = acl as any
    aclRecord.isSuperAdmin = isSuperAdmin
    aclRecord.featuresJson = features
    aclRecord.organizationsJson = organizations
    await em.persistAndFlush(acl)
  }
  
  // Invalidate cache for this user
  await rbacService.invalidateUserCache(parsed.data.userId)
  // Sidebar nav is cached per user; invalidate by rbac user tag
  try {
    const { resolve } = await createRequestContainer()
    const cache = resolve('cache') as any
    if (cache) await cache.deleteByTags([`rbac:user:${parsed.data.userId}`])
  } catch {}
  
  return NextResponse.json({ ok: true })
}

