import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { logCrudAccess } from '@open-mercato/shared/lib/crud/factory'
import { forbidden, isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLock } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { UserAcl } from '@open-mercato/core/modules/auth/data/entities'
import {
  assertActorCanAccessUserTarget,
  assertActorCanGrantAcl,
  assertActorCanModifySuperAdminUserTarget,
  normalizeGrantFeatureList,
} from '@open-mercato/core/modules/auth/lib/grantChecks'
import type { RbacService } from '@open-mercato/core/modules/auth/services/rbacService'
import type { EntityManager } from '@mikro-orm/postgresql'

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

const userAclResponseSchema = z.object({
  hasCustomAcl: z.boolean(),
  isSuperAdmin: z.boolean(),
  features: z.array(z.string()),
  organizations: z.array(z.string()).nullable(),
  updatedAt: z.string().nullable(),
})

const userAclUpdateResponseSchema = z.object({
  ok: z.literal(true),
  sanitized: z.boolean(),
})

const userAclErrorSchema = z.object({ error: z.string() })

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsed = getSchema.safeParse({ userId: url.searchParams.get('userId') })
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const container = await createRequestContainer()
  const em = container.resolve('em') as any
  const rbacService = container.resolve('rbacService') as any
  const actorAcl = auth.sub
    ? await rbacService.loadAcl(auth.sub, { tenantId: auth.tenantId ?? null, organizationId: auth.orgId ?? null })
    : null
  if (!actorAcl?.isSuperAdmin && auth.sub) {
    try {
      await assertActorCanModifySuperAdminUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
      })
      await assertActorCanAccessUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }
  const acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
  const response = acl
    ? {
        hasCustomAcl: true,
        isSuperAdmin: !!acl.isSuperAdmin,
        features: Array.isArray(acl.featuresJson) ? acl.featuresJson : [],
        organizations: Array.isArray(acl.organizationsJson) ? acl.organizationsJson : null,
        updatedAt: acl.updatedAt instanceof Date ? acl.updatedAt.toISOString() : null,
      }
    : { hasCustomAcl: false, isSuperAdmin: false, features: [], organizations: null, updatedAt: null }

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

  if (!actorIsSuperAdmin && auth.sub) {
    try {
      await assertActorCanModifySuperAdminUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
      })
      await assertActorCanAccessUserTarget({
        em: em as EntityManager,
        rbacService: rbacService as RbacService,
        actorUserId: auth.sub,
        tenantId: auth.tenantId ?? null,
        organizationId: auth.orgId ?? null,
        targetUserId: parsed.data.userId,
        actorIsSuperAdmin: false,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }

  const requestedFeatures = normalizeGrantFeatureList(parsed.data.features)
  const organizations = normalizeOrganizations(parsed.data.organizations)

  let acl = await em.findOne(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
  // Optimistic lock: refuse a stale per-user ACL overwrite so concurrent edits
  // cannot silently clobber each other (#2055). Strictly additive — a no-op when
  // the client sends no expected-version header; skipped when no ACL row exists.
  if (acl) {
    try {
      enforceCommandOptimisticLock({
        resourceKind: 'auth.user_acl',
        resourceId: acl.id,
        current: acl.updatedAt ?? null,
        request: req,
      })
    } catch (err) {
      if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
      throw err
    }
  }
  const existingIsSuperAdmin = acl ? !!acl.isSuperAdmin : false
  const existingFeatures = acl ? normalizeGrantFeatureList(acl.featuresJson) : []

  const requestedIsSuperAdmin = parsed.data.isSuperAdmin ?? false

  try {
    await assertActorCanGrantAcl({
      em: em as EntityManager,
      rbacService: rbacService as RbacService,
      actorUserId: auth.sub,
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
      isSuperAdmin: requestedIsSuperAdmin,
      features: requestedFeatures,
      organizations,
    })
  } catch (err) {
    if (isCrudHttpError(err)) return NextResponse.json(err.body, { status: err.status })
    throw err
  }

  const effectiveFeatures = actorIsSuperAdmin
    ? requestedFeatures
    : sanitizeTenantFeatures(requestedFeatures)

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

  // Persist the ACL mutation inside a transaction so the per-user permission
  // write (or removal) commits atomically (proper ACL-edit transaction handling).
  if (!hasCustomAcl) {
    if (acl) {
      const aclToRemove = acl
      await withAtomicFlush(em, [() => em.remove(aclToRemove)], { transaction: true })
    }
  } else {
    if (!acl) {
      acl = em.create(UserAcl, { user: parsed.data.userId as any, tenantId: auth.tenantId as any })
    }
    const aclRecord = acl as any
    await withAtomicFlush(
      em,
      [
        () => {
          aclRecord.isSuperAdmin = effectiveIsSuperAdmin
          aclRecord.featuresJson = effectiveFeatures
          aclRecord.organizationsJson = organizations
          em.persist(aclRecord)
        },
      ],
      { transaction: true },
    )
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

function normalizeOrganizations(organizations: unknown): string[] | null {
  if (!Array.isArray(organizations)) return null
  return normalizeGrantFeatureList(organizations)
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

export const openApi: OpenApiRouteDoc = {
  tag: 'Authentication & Accounts',
  summary: 'User ACL management',
  methods: {
    GET: {
      summary: 'Fetch user ACL',
      description: 'Returns custom ACL overrides for a user within the current tenant, if any.',
      query: getSchema,
      responses: [
        { status: 200, description: 'User ACL entry', schema: userAclResponseSchema },
        { status: 400, description: 'Invalid user id', schema: userAclErrorSchema },
        { status: 401, description: 'Unauthorized', schema: userAclErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update user ACL',
      description: 'Configures per-user ACL overrides, including super admin access, feature list, and organization scope.',
      requestBody: {
        contentType: 'application/json',
        schema: putSchema,
      },
      responses: [
        { status: 200, description: 'User ACL updated', schema: userAclUpdateResponseSchema },
        { status: 400, description: 'Invalid payload', schema: userAclErrorSchema },
        { status: 401, description: 'Unauthorized', schema: userAclErrorSchema },
        { status: 403, description: 'Insufficient privileges to modify ACL', schema: userAclErrorSchema },
      ],
    },
  },
}
